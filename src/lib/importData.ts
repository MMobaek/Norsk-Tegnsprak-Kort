import { db } from './db';
import { D0 } from './fsrs';
import { sha256Hex } from './hash';
import { parseTegn, slugify, prettifyName, VIDEO_BASE } from './parser';
import type { Card, Deck, Direction } from './types';

export interface ImportResult {
  items: number;
  skipped: number;
  added: number;
  updated: number;
  decks: number;
}

const SYNC_FIELDS = [
  'deckId',
  'direction',
  'videoUrl',
  'description',
  'tags',
  'state',
  'stepIndex',
  'stability',
  'difficulty',
  'dueTimestamp',
  'lastReviewedTimestamp',
  'consecCorrect',
  'lapses',
  'reps'
] as const;

function sameSchedule(a: Card, b: Card): boolean {
  if (JSON.stringify(a.pendingBandit ?? null) !== JSON.stringify(b.pendingBandit ?? null)) {
    return false;
  }
  for (const f of SYNC_FIELDS) {
    if (f === 'tags') {
      if (a.tags.length !== b.tags.length || a.tags.some((t, i) => t !== b.tags[i])) return false;
    } else if (a[f] !== b[f]) {
      return false;
    }
  }
  return true;
}

export async function importDataset(
  onProgress?: (done: number, total: number) => void
): Promise<ImportResult> {
  const res = await fetch('data.php.xml');
  if (!res.ok) throw new Error(`Could not load dataset (HTTP ${res.status})`);
  const text = await res.text();
  const { items, skipped } = parseTegn(text);

  const deckMap = new Map<string, Deck>();
  deckMap.set('nts', { id: 'nts', name: 'NTS' });
  let hasUncategorized = false;
  for (const it of items) {
    const primary = it.groups[0];
    if (!primary) {
      hasUncategorized = true;
      continue;
    }
    const id = slugify(primary);
    if (!deckMap.has(id)) deckMap.set(id, { id, name: prettifyName(id), parentId: 'nts' });
  }
  if (hasUncategorized) {
    deckMap.set('ukategorisert', { id: 'ukategorisert', name: 'Ukategorisert', parentId: 'nts' });
  }
  await db.decks.bulkPut([...deckMap.values()]);

  const existing = new Map((await db.cards.toArray()).map((c) => [c.id, c]));
  const directions: Direction[] = ['production', 'comprehension'];
  const usedIds = new Set<string>();
  let added = 0;
  let updated = 0;
  let buffer: Card[] = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const deckId = it.groups[0] ? slugify(it.groups[0]) : 'ukategorisert';
    const rawVideo = it.video.includes('.') ? it.video : `${it.video}.mp4`;
    const videoUrl = VIDEO_BASE + encodeURIComponent(rawVideo);
    const [prodId, compId] = await Promise.all([
      uniqueId(usedIds, `${it.video}:production`, `${it.video}:production:${it.description}`),
      uniqueId(usedIds, `${it.video}:comprehension`, `${it.video}:comprehension:${it.description}`)
    ]);
    for (const direction of directions) {
      const id = direction === 'production' ? prodId : compId;
      const prev = existing.get(id);
      if (prev) {
        const merged: Card = {
          id,
          deckId,
          direction,
          videoUrl,
          description: it.description,
          tags: it.groups,
          state: prev.state,
          stepIndex: prev.stepIndex,
          stability: prev.stability,
          difficulty: prev.difficulty,
          dueTimestamp: prev.dueTimestamp,
          lastReviewedTimestamp: prev.lastReviewedTimestamp,
          consecCorrect: prev.consecCorrect,
          lapses: prev.lapses,
          reps: prev.reps,
          pendingBandit: prev.pendingBandit
        };
        if (sameSchedule(prev, merged)) continue;
        buffer.push(merged);
        updated++;
      } else {
        buffer.push({
          id,
          deckId,
          direction,
          videoUrl,
          description: it.description,
          tags: it.groups,
          state: 'new',
          stepIndex: 0,
          stability: 0,
          difficulty: D0,
          dueTimestamp: Date.now(),
          consecCorrect: 0,
          lapses: 0,
          reps: 0
        });
        added++;
      }
    }
    onProgress?.(i + 1, items.length);
    if (buffer.length >= 1000) {
      await db.cards.bulkPut(buffer);
      buffer = [];
    }
  }
  if (buffer.length) await db.cards.bulkPut(buffer);

  return { items: items.length, skipped, added, updated, decks: deckMap.size };
}

async function uniqueId(
  usedIds: Set<string>,
  primary: string,
  fallback: string
): Promise<string> {
  const first = await sha256Hex(primary);
  if (!usedIds.has(first)) {
    usedIds.add(first);
    return first;
  }
  const second = await sha256Hex(fallback);
  usedIds.add(second);
  return second;
}
