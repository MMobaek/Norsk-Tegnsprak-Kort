import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { db } from '../db';
import type { Card } from '../types';
import {
  ApkgZip,
  buildCollectionDb,
  deckCategoryName,
  ROOT_DECK,
  type AnkiCardSource
} from './ankilib';
import {
  collectVideoFilenames,
  downloadVideos,
  videoFilenameFromUrl,
  type FetchLike
} from './mediaBundle';

export const APKG_FILENAME = 'Norsk_Tegnsprak_Export.apkg';

export interface ApkgProgress {
  phase: 'videos' | 'build';
  done: number;
  total: number;
}

export interface ApkgResult {
  cards: number;
  notes: number;
  decks: number;
  videos: number;
  videoFailures: number;
  totalVideoBytes: number;
  blob: Blob;
}

function toSource(c: Card): AnkiCardSource {
  return {
    id: c.id,
    direction: c.direction,
    description: c.description,
    video: c.videoUrl,
    tags: c.tags
  };
}

export async function exportApkg(
  onProgress?: (p: ApkgProgress) => void,
  fetchFn?: FetchLike
): Promise<ApkgResult> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const cards = await db.cards.filter((c) => c.state !== 'discarded').sortBy('id');
  const rawSources = cards.map(toSource);
  const filenames = collectVideoFilenames(rawSources);

  const zip = new ApkgZip();
  const { failed, resolved, totalBytes } = await downloadVideos(
    filenames,
    zip,
    (done, total) => onProgress?.({ phase: 'videos', done, total }),
    fetchFn
  );

  const sources = rawSources.map((s) => {
    const fn = videoFilenameFromUrl(s.video);
    const actual = resolved.get(fn);
    return actual ? { ...s, video: actual } : s;
  });

  const dbBytes = await buildCollectionDb(SQL, sources, (done, total) =>
    onProgress?.({ phase: 'build', done, total })
  );
  const blob = await zip.finish(dbBytes);

  const decks = new Set(
    sources.map((s) => `${ROOT_DECK}::${deckCategoryName(s.tags[0] ?? '')}`)
  ).size;
  return {
    cards: cards.length,
    notes: cards.length,
    decks,
    videos: filenames.length - failed.size,
    videoFailures: failed.size,
    totalVideoBytes: totalBytes,
    blob
  };
}

export function downloadApkg(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = APKG_FILENAME;
  a.click();
  URL.revokeObjectURL(url);
}
