import { buildAnkiTsv, escapeTsvField, TSV_HEADER, TSV_SEPARATOR } from './src/lib/anki/exportTsv.ts';
import type { Card } from './src/lib/types.ts';

function card(over: Partial<Card>): Card {
  return {
    id: over.id ?? 'x'.repeat(64),
    deckId: 't',
    direction: 'production',
    videoUrl: 'https://www.minetegn.no/Tegnordbok-HTML/videos/bil.mp4',
    description: 'bil',
    tags: ['transport'],
    state: 'new',
    stepIndex: 0,
    stability: 0,
    difficulty: 5,
    dueTimestamp: 0,
    consecCorrect: 0,
    lapses: 0,
    reps: 0,
    ...over
  };
}

function parseTsv(content: string): string[][] {
  const lines = content.split('\r\n');
  return lines.map((l) => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (inQuotes) {
        if (ch === '"') {
          if (l[i + 1] === '"') {
            cur += '"';
            i++;
          } else inQuotes = false;
        } else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === '\t') {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  });
}

async function main() {
  if (escapeTsvField('plain') !== 'plain') throw new Error('plain escaping wrong');
  if (escapeTsvField('med "sitat"') !== '"med ""sitat"""') throw new Error('quote escaping wrong');
  if (escapeTsvField('tab\there') !== '"tab\there"') throw new Error('tab escaping wrong');
  if (escapeTsvField('comma, here') !== 'comma, here')
    throw new Error('commas must not be quoted for tab separator');
  console.log('escaping: PASS');

  const cards: Card[] = [
    card({ description: 'bil', videoUrl: 'https://x/videos/bil.mp4', tags: ['transport', 'bil og vei'] }),
    card({ id: 'y'.repeat(64), direction: 'comprehension', description: 'bil', videoUrl: 'https://x/videos/bil.mp4', tags: ['transport', 'bil og vei'] }),
    card({ id: 'z'.repeat(64), description: 'gås', videoUrl: 'https://x/videos/g%C3%A5s.mp4', tags: [] }),
    card({ id: 'd'.repeat(64), description: 'forkastet', state: 'discarded' }),
    card({ id: 'e'.repeat(64), description: 'ære med "sitat"', videoUrl: 'https://x/videos/aere.mp4', tags: [] })
  ];

  const { content, rows } = buildAnkiTsv(cards);
  console.log('rows:', rows, 'content length:', content.length);
  if (rows !== 3) throw new Error('dedup/skip wrong');
  if (!content.includes('ære')) throw new Error('utf-8 broken');
  if (!content.includes('g%C3%A5s')) throw new Error('encoded url broken');

  const parsed = parseTsv(content);
  if (parsed[0].join('|') !== TSV_HEADER.join('|')) throw new Error('header wrong');
  if (parsed.length !== rows + 1) throw new Error('line count wrong');
  const wordCol = parsed.slice(1).map((r) => r[0]);
  if (!wordCol.includes('bil') || !wordCol.includes('gås') || !wordCol.includes('ære med "sitat"'))
    throw new Error('word column wrong');
  const quoteRow = parsed.find((r) => r[0].includes('sitat'));
  if (!quoteRow || quoteRow[0] !== 'ære med "sitat"') throw new Error('quote roundtrip wrong');
  for (const row of parsed) {
    if (row.length !== 4) throw new Error(`column count wrong: ${row.length}`);
  }
  const bilRow = parsed.find((r) => r[0] === 'bil');
  if (!bilRow || bilRow[1] !== 'https://x/videos/bil.mp4') throw new Error('video column wrong');
  if (bilRow[2] !== 'transport, bil og vei') throw new Error('category column wrong');
  if (bilRow[3] !== '') throw new Error('notes column wrong');
  if (parsed[0][0] === 'Word') console.log('header starts with Word');

  console.log('TSV separator:', JSON.stringify(TSV_SEPARATOR));
  console.log('tsv export: PASS');
}

main().catch((e) => {
  console.error('tsv export: FAIL', e);
  process.exit(1);
});
