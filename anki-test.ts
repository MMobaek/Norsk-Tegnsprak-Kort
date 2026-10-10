import initSqlJs from 'sql.js';
import { unzipSync } from 'fflate';
import {
  buildApkgBlob,
  buildCollectionDb,
  deckCategoryName,
  guidFromHash,
  MODEL_NAME,
  ROOT_DECK,
  type AnkiCardSource,
  type MediaEntry
} from './src/lib/anki/ankilib.ts';
import {
  collectVideoFilenames,
  videoFilenameFromUrl,
  type FetchLike
} from './src/lib/anki/mediaBundle.ts';

async function csumOf(field: string): Promise<number> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(field));
  const b = new Uint8Array(buf);
  return (((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0);
}

const cards: AnkiCardSource[] = [
  { id: 'a'.repeat(64), direction: 'production', description: '1 000 m', video: 'https://www.minetegn.no/Tegnordbok-HTML/videos/bytte-1.mp4', tags: ['idrett'] },
  { id: 'b'.repeat(64), direction: 'comprehension', description: '1 000 m', video: 'https://www.minetegn.no/Tegnordbok-HTML/videos/bytte-1.mp4', tags: ['idrett'] },
  { id: 'c'.repeat(64), direction: 'production', description: '2', video: 'https://www.minetegn.no/Tegnordbok-HTML/videos/bytte-2.mp4', tags: ['tall'] },
  { id: 'd'.repeat(64), direction: 'comprehension', description: 'brød', video: 'https://www.minetegn.no/Tegnordbok-HTML/videos/g%C3%A5s.mp4', tags: ['mat/drikke'] },
  { id: 'e'.repeat(64), direction: 'production', description: 'solo', video: 'https://www.minetegn.no/Tegnordbok-HTML/videos/bytte-1.mp4', tags: [] }
];

const media: MediaEntry[] = [
  { archivedName: '0', filename: 'bytte-1.mp4', bytes: new Uint8Array([1, 2, 3, 4]) },
  { archivedName: '1', filename: 'bytte-2.mp4', bytes: new Uint8Array([5, 6, 7, 8]) },
  { archivedName: '2', filename: 'gås.mp4', bytes: new Uint8Array([9, 10]) }
];

async function main() {
  const names = [
    deckCategoryName('mat/drikke'),
    deckCategoryName('tall'),
    deckCategoryName(''),
    deckCategoryName('   ')
  ];
  console.log('deck names:', names.join(' | '));
  if (names[0] !== 'Mat og drikke') throw new Error('slash category wrong');
  if (names[1] !== 'Tall') throw new Error('capitalization wrong');
  if (names[2] !== 'Diverse' || names[3] !== 'Diverse') throw new Error('fallback wrong');

  const g = guidFromHash('ab'.repeat(32));
  if (g.length !== 10) throw new Error('guid must be 10 chars');

  if (videoFilenameFromUrl('https://x/videos/g%C3%A5s.mp4') !== 'gås.mp4')
    throw new Error('filename decode wrong');
  if (videoFilenameFromUrl('https://x/videos/1aar.mp4') !== '1aar.mp4')
    throw new Error('filename plain wrong');

  const filenames = collectVideoFilenames(cards);
  console.log('unique filenames:', filenames.join(', '));
  if (filenames.length !== 3) throw new Error('dedup wrong');
  if (filenames[0] !== 'bytte-1.mp4' || filenames[1] !== 'bytte-2.mp4' || filenames[2] !== 'gås.mp4')
    throw new Error('filename order wrong');

  const SQL = await initSqlJs();
  const localCards = cards.map((c) => {
    const fn = videoFilenameFromUrl(c.video);
    return fn === 'gås.mp4' ? { ...c, video: c.video } : { ...c, video: fn };
  });
  const bytes = await buildCollectionDb(SQL, localCards, () => {});
  console.log('db size:', bytes.length);

  const db = new SQL.Database(bytes);
  const col = db.exec('SELECT ver, models, decks FROM col')[0];
  if (col.values[0][0] !== 11) throw new Error('schema version wrong');
  const models = JSON.parse(col.values[0][1] as string);
  const model = models[Object.keys(models)[0]];
  if (model.flds[3].name !== 'Video') throw new Error('field should be named Video');
  if (!model.tmpls[0].afmt.includes('src="{{Video}}"')) throw new Error('template missing local video ref');
  if (!model.tmpls[1].qfmt.includes('src="{{Video}}"')) throw new Error('template 2 missing local video ref');

  const notes = db.exec('SELECT flds FROM notes')[0];
  for (const row of notes.values) {
    const parts = (row[0] as string).split('\x1f');
    if (!parts[3].endsWith('.mp4')) throw new Error('Video field should be a filename or url');
  }
  const bytteNote = notes.values[0];
  const bytteParts = (bytteNote[0] as string).split('\x1f');
  if (bytteParts[3] !== 'bytte-1.mp4') throw new Error('local filename not stored');
  const gaasNote = notes.values[3];
  const gaasParts = (gaasNote[0] as string).split('\x1f');
  if (!gaasParts[3].startsWith('https://')) throw new Error('failed download should keep remote url');

  const blob = await buildApkgBlob(bytes, media);
  const zipBytes = new Uint8Array(await blob.arrayBuffer());
  const zip = unzipSync(zipBytes);
  const entries = Object.keys(zip);
  console.log('zip entries:', entries.join(', '));
  for (const e of ['collection.anki2', 'media', '0', '1', '2']) {
    if (!entries.includes(e)) throw new Error(`zip entry ${e} missing`);
  }
  const mediaMap = JSON.parse(new TextDecoder().decode(zip['media']));
  console.log('media map:', JSON.stringify(mediaMap));
  if (mediaMap['0'] !== 'bytte-1.mp4' || mediaMap['1'] !== 'bytte-2.mp4' || mediaMap['2'] !== 'gås.mp4')
    throw new Error('media map wrong');
  if (zip['0'].length !== 4 || zip['1'].length !== 4 || zip['2'].length !== 2)
    throw new Error('media bytes wrong');

  const reopened = new SQL.Database(zip['collection.anki2']);
  const count = reopened.exec('SELECT COUNT(*) FROM notes')[0].values[0][0];
  if (count !== cards.length) throw new Error('zip content corrupt');
  reopened.close();
  db.close();

  const failingFetch: FetchLike = async (input) => {
    if (String(input).includes('bytte-2')) return { ok: false, status: 404 } as Response;
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([7, 7]).buffer } as Response;
  };
  const { ApkgZip } = await import('./src/lib/anki/ankilib.ts');
  const zip2 = new ApkgZip();
  const { downloadVideos } = await import('./src/lib/anki/mediaBundle.ts');
  let lastProgress = 0;
  const res = await downloadVideos(filenames, zip2, (done, total) => {
    lastProgress = done;
    if (total !== 3) throw new Error('progress total wrong');
  }, failingFetch);
  console.log('download failures:', [...res.failed].join(','));
  if (!res.failed.has('bytte-2.mp4')) throw new Error('failure not detected');
  if (res.failed.size !== 1) throw new Error('wrong failure count');
  if (lastProgress !== 3) throw new Error('progress not reported to completion');
  const blob2 = await zip2.finish(new Uint8Array([1]));
  const zipEntries2 = Object.keys(unzipSync(new Uint8Array(await blob2.arrayBuffer())));
  console.log('partial zip entries:', zipEntries2.join(', '));
  if (zipEntries2.includes('2')) throw new Error('failed video must not be in zip');

  const retryFetch: FetchLike = async (input) => {
    const last = String(input).split('/').pop();
    if (last === 'monosakkarid') return { ok: false, status: 404 } as Response;
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([9]).buffer } as Response;
  };
  const zip3 = new ApkgZip();
  const res3 = await downloadVideos(['monosakkarid'], zip3, () => {}, retryFetch);
  console.log('retry resolution:', res3.resolved.get('monosakkarid'), 'failures:', res3.failed.size);
  if (res3.failed.size !== 0) throw new Error('extension retry should succeed');
  if (res3.resolved.get('monosakkarid') !== 'monosakkarid.mp4') throw new Error('resolution wrong');
  const blob3 = await zip3.finish(new Uint8Array([1]));
  const zipObj3 = unzipSync(new Uint8Array(await blob3.arrayBuffer()));
  const mediaMap3 = JSON.parse(new TextDecoder().decode(zipObj3['media']));
  if (mediaMap3['0'] !== 'monosakkarid.mp4') throw new Error('retry media map wrong');

  console.log('anki export: PASS');
}

main().catch((e) => {
  console.error('anki export: FAIL', e);
  process.exit(1);
});
