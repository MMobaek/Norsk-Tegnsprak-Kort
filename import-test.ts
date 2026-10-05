import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { db } from './src/lib/db.ts';
import { importDataset } from './src/lib/importData.ts';
import { sha256Hex } from './src/lib/hash.ts';

class FakeElement {
  constructor(
    private attrs: Record<string, string>,
    private text: string
  ) {}
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  get textContent(): string {
    return this.text;
  }
}

class FakeDoc {
  constructor(private tegn: FakeElement[]) {}
  getElementsByTagName(tag: string): FakeElement[] {
    return tag === 'tegn' ? this.tegn : [];
  }
}

class FakeDOMParser {
  parseFromString(text: string): FakeDoc {
    const items: FakeElement[] = [];
    const re = /<tegn\b([^>]*)>([\s\S]*?)<\/tegn>/g;
    for (const m of text.matchAll(re)) {
      const attrs: Record<string, string> = {};
      for (const a of m[1].matchAll(/([a-zA-Z0-9_]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
      items.push(new FakeElement(attrs, m[2]));
    }
    return new FakeDoc(items);
  }
}

(globalThis as Record<string, unknown>).DOMParser = FakeDOMParser;
(globalThis as Record<string, unknown>).fetch = async () => {
  const xml = readFileSync('./public/data.php.xml', 'utf8');
  return { ok: true, status: 200, text: async () => xml };
};

async function main() {
  const r1 = await importDataset();
  console.log('import 1:', JSON.stringify(r1));
  if (r1.items !== 9135) throw new Error('wrong item count');
  if (r1.skipped !== 2015) throw new Error('wrong skip count');
  if (r1.added !== 18270) throw new Error('wrong added count');

  const cards = await db.cards.count();
  const decks = await db.decks.count();
  console.log('cards:', cards, 'decks:', decks);
  if (cards !== 18270) throw new Error('wrong card count');

  const idrett = await db.cards
    .filter((c) => c.description === '1 000 m')
    .first();
  if (!idrett) throw new Error('card "1 000 m" not found');
  console.log('sample card:', idrett.deckId, idrett.tags.join(','), idrett.direction);
  if (idrett.deckId !== 'idrett') throw new Error('wrong deck assignment');
  if (!idrett.tags.includes('idrett')) throw new Error('missing tag');
  const expectedId = await sha256Hex(`1-000-m.mp4:${idrett.direction}`);
  if (idrett.id !== expectedId) throw new Error('id hash mismatch');
  if (idrett.videoUrl !== 'https://www.minetegn.no/Tegnordbok-HTML/videos/1-000-m.mp4')
    throw new Error('wrong video url');

  console.log('updating card...');
  await db.cards.update(idrett.id, { state: 'review', stability: 12.5, reps: 42 });
  console.log('update done, re-importing...');
  const r2 = await importDataset();
  console.log('import 2 (re-import):', JSON.stringify(r2));
  if (r2.added !== 0) throw new Error('re-import should not add cards');
  const kept = await db.cards.get(idrett.id);
  if (!kept || kept.state !== 'review' || kept.stability !== 12.5 || kept.reps !== 42)
    throw new Error('scheduling state was not preserved on re-import');

  const ntsDeck = await db.decks.get('nts');
  const child = await db.decks.where('parentId').equals('nts').count();
  if (!ntsDeck || child === 0) throw new Error('deck hierarchy broken');

  console.log('import pipeline: PASS');
}

main().catch((e) => {
  console.error('import pipeline: FAIL', e);
  process.exit(1);
});
