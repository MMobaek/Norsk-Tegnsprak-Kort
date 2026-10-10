import type { Card } from '../types';

export const TSV_HEADER = ['Word', 'VideoURL', 'Category', 'Notes'];
export const ANKI_TSV_FILENAME = 'Norsk_tegnsprak_export.txt';
export const TSV_SEPARATOR = '\t';

export function escapeTsvField(value: string): string {
  if (/["\t\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildAnkiTsv(cards: Card[]): { content: string; rows: number } {
  const seen = new Set<string>();
  const rows: string[][] = [];
  for (const c of cards) {
    if (c.state === 'discarded') continue;
    const key = `${c.videoUrl}\u001f${c.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push([c.description, c.videoUrl, c.tags.join(', '), '']);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0], 'nb'));
  const lines = [TSV_HEADER.join(TSV_SEPARATOR), ...rows.map((r) => r.map(escapeTsvField).join(TSV_SEPARATOR))];
  return { content: lines.join('\r\n'), rows: rows.length };
}

export function downloadTextFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/tab-separated-values;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
