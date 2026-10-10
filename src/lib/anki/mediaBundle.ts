import { VIDEO_BASE } from '../parser';
import type { AnkiCardSource } from './ankilib';
import type { ApkgZip } from './ankilib';

export const DOWNLOAD_CONCURRENCY = 4;
const DOWNLOAD_TIMEOUT_MS = 30000;
const PROGRESS_INTERVAL_MS = 250;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function videoFilenameFromUrl(url: string): string {
  try {
    const last = url.split('/').pop() ?? '';
    return decodeURIComponent(last);
  } catch {
    return url.split('/').pop() ?? url;
  }
}

export function collectVideoFilenames(sources: AnkiCardSource[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sources) {
    const fn = videoFilenameFromUrl(s.video);
    if (!seen.has(fn)) {
      seen.add(fn);
      out.push(fn);
    }
  }
  return out;
}

async function fetchVideo(
  filename: string,
  fetchFn: FetchLike
): Promise<Uint8Array | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetchFn(VIDEO_BASE + encodeURIComponent(filename), {
      signal: controller.signal
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface VideoDownloadResult {
  failed: Set<string>;
  resolved: Map<string, string>;
  totalBytes: number;
}

export async function downloadVideos(
  filenames: string[],
  zip: ApkgZip,
  onProgress: (done: number, total: number) => void,
  fetchFn: FetchLike = fetch
): Promise<VideoDownloadResult> {
  const failed = new Set<string>();
  const resolved = new Map<string, string>();
  let totalBytes = 0;
  let done = 0;
  let next = 0;
  let lastReport = 0;

  const report = () => {
    const now = Date.now();
    if (now - lastReport >= PROGRESS_INTERVAL_MS || done === filenames.length) {
      lastReport = now;
      onProgress(done, filenames.length);
    }
  };

  const runnerCount = Math.min(DOWNLOAD_CONCURRENCY, Math.max(filenames.length, 1));
  const runners = Array.from({ length: runnerCount }, async () => {
    while (true) {
      const i = next++;
      if (i >= filenames.length) break;
      const fn = filenames[i];
      let bytes = await fetchVideo(fn, fetchFn);
      let actual = fn;
      if (!bytes && !fn.includes('.')) {
        actual = `${fn}.mp4`;
        bytes = await fetchVideo(actual, fetchFn);
      }
      if (bytes) {
        totalBytes += bytes.length;
        zip.addMediaEntry(actual, bytes);
        resolved.set(fn, actual);
      } else {
        failed.add(fn);
      }
      done++;
      report();
    }
  });
  await Promise.all(runners);
  report();
  return { failed, resolved, totalBytes };
}
