export const VIDEO_BASE = 'https://www.minetegn.no/Tegnordbok-HTML/videos/';

export interface RawTegn {
  video: string;
  description: string;
  groups: string[];
}

export function slugify(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9æøå-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'ukategorisert';
}

export function prettifyName(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function parseTegn(text: string): { items: RawTegn[]; skipped: number } {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const roots = doc.getElementsByTagName('tegn');
  if (doc.getElementsByTagName('parsererror').length > 0 || roots.length === 0) {
    const items: RawTegn[] = [];
    let skipped = 0;
    const re = /<tegn\b[^>]*>[\s\S]*?<\/tegn>/g;
    for (const m of text.matchAll(re)) {
      const d = new DOMParser().parseFromString(`<banken>${m[0]}</banken>`, 'application/xml');
      const ex = extract(d);
      items.push(...ex.items);
      skipped += ex.skipped;
    }
    return { items, skipped };
  }
  return extract(doc);
}

function extract(doc: Document): { items: RawTegn[]; skipped: number } {
  const items: RawTegn[] = [];
  let skipped = 0;
  for (const el of Array.from(doc.getElementsByTagName('tegn'))) {
    const video = (el.getAttribute('video') ?? '').trim();
    if (!video) {
      skipped++;
      continue;
    }
    const groups = ['grupp1', 'grupp2', 'grupp3', 'grupp4']
      .map((g) => (el.getAttribute(g) ?? '').trim())
      .filter((g) => g && g.toLowerCase() !== 'alle tegn');
    items.push({ video, description: (el.textContent ?? '').trim(), groups });
  }
  return { items, skipped };
}
