import 'fake-indexeddb/auto';
import initSqlJs from 'sql.js';
import { unzipSync } from 'fflate';
import { db } from './src/lib/db.ts';
import { importDataset } from './src/lib/importData.ts';
import {
  ApkgZip,
  buildCollectionDb,
  ROOT_DECK,
  type AnkiCardSource
} from './src/lib/anki/ankilib.ts';
import {
  collectVideoFilenames,
  downloadVideos,
  videoFilenameFromUrl,
  type FetchLike
} from './src/lib/anki/mediaBundle.ts';

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

const { readFileSync } = await import('node:fs');
(globalThis as Record<string, unknown>).fetch = async () => {
  const xml = readFileSync('./public/data.php.xml', 'utf8');
  return { ok: true, status: 200, text: async () => xml };
};

let failThis: string | null = 'foerstegradsforbrenning.mp4';
const fakeVideoFetch: FetchLike = async (input) => {
  const encoded = String(input).split('/').pop() ?? '';
  const filename = decodeURIComponent(encoded);
  if (filename === failThis) return { ok: false, status: 404 } as Response;
  const size = 1000 + (filename.length * 37) % 5000;
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new Uint8Array(size).buffer
  } as Response;
};

async function main() {
  await importDataset();
  const all = await db.cards.filter((c) => c.state !== 'discarded').sortBy('id');
  const rawSources: AnkiCardSource[] = all.map((c) => ({
    id: c.id,
    direction: c.direction,
    description: c.description,
    video: c.videoUrl,
    tags: c.tags
  }));
  console.log('cards to export:', rawSources.length);

  const filenames = collectVideoFilenames(rawSources);
  console.log('unique videos:', filenames.length);

  const zip = new ApkgZip();
  let videoProgress = 0;
  let lastReport = 0;
  const t0 = Date.now();
  const { failed, totalBytes } = await downloadVideos(filenames, zip, (done, total) => {
    videoProgress = done;
    lastReport = total;
  }, fakeVideoFetch);
  console.log(
    'downloads done:',
    Date.now() - t0,
    'ms, failed:',
    failed.size,
    'bytes:',
    totalBytes,
    'progress:',
    videoProgress,
    '/',
    lastReport
  );
  if (failed.size !== 1 || !failed.has('foerstegradsforbrenning.mp4'))
    throw new Error('failure handling wrong');
  if (videoProgress !== filenames.length) throw new Error('progress incomplete');

  const sources = rawSources.map((s) => {
    const fn = videoFilenameFromUrl(s.video);
    return failed.has(fn) ? s : { ...s, video: fn };
  });
  const SQL = await initSqlJs();
  const bytes = await buildCollectionDb(SQL, sources, () => {});
  const blob = await zip.finish(bytes);
  const zipBytes = new Uint8Array(await blob.arrayBuffer());
  console.log('final zip size:', zipBytes.length, 'bytes');

  const zipObj = unzipSync(zipBytes);
  const entries = Object.keys(zipObj);
  console.log('zip entry count:', entries.length);
  if (!entries.includes('collection.anki2') || !entries.includes('media'))
    throw new Error('zip core files missing');

  const mediaMap = JSON.parse(new TextDecoder().decode(zipObj['media'])) as Record<string, string>;
  console.log('media map entries:', Object.keys(mediaMap).length);
  if (Object.keys(mediaMap).length !== filenames.length - failed.size)
    throw new Error('media map size wrong');
  for (const key of Object.keys(mediaMap)) {
    if (!entries.includes(key)) throw new Error(`zip missing media entry ${key}`);
    if (!mediaMap[key].endsWith('.mp4')) throw new Error('media map value should be filename');
  }
  if (Object.values(mediaMap).includes('foerstegradsforbrenning.mp4'))
    throw new Error('failed video must not appear in media map');

  const db2 = new SQL.Database(zipObj['collection.anki2']);
  const rows = db2.exec('SELECT flds FROM notes')[0];
  let localCount = 0;
  let remoteCount = 0;
  for (const row of rows.values) {
    const parts = (row[0] as string).split('\x1f');
    if (parts[3].startsWith('https://')) remoteCount++;
    else if (parts[3].endsWith('.mp4')) localCount++;
    else throw new Error(`unexpected Video field: ${parts[3]}`);
  }
  console.log('notes with local video:', localCount, 'remote fallback:', remoteCount);
  const expectedRemote = sources.filter(
    (s) => videoFilenameFromUrl(s.video) === 'foerstegradsforbrenning.mp4'
  ).length;
  if (remoteCount !== expectedRemote) throw new Error(`remote fallback count wrong: ${remoteCount}`);
  if (localCount !== sources.length - expectedRemote) throw new Error('local filename count wrong');

  const sample = db2.exec("SELECT flds FROM notes WHERE flds LIKE '%bytte%' LIMIT 1");
  if (sample.length) console.log('sample note flds:', (sample[0].values[0][0] as string).split('\x1f')[3]);
  db2.close();

  console.log('full-scale anki export (with media): PASS');
}

main().catch((e) => {
  console.error('full-scale anki export: FAIL', e);
  process.exit(1);
});
