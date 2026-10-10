import { db } from './db';

export const ANKI_CONNECT_URL = 'http://localhost:8765';
export const DECK_NAME = 'Norsk Tegnspråk';

const UNCATEGORIZED_DECK_ID = 'ukategorisert';
const NOTE_TAGS = ['tegnspråk', 'NTS'];
const ADD_BATCH_SIZE = 50;

export const ANKI_CONNECTION_ERROR =
  'Could not connect to Anki. Please ensure Anki is running and the AnkiConnect add-on is installed.';

export class AnkiError extends Error {}
export class AnkiConnectionError extends Error {}

interface AnkiConnectResponse<T> {
  result: T;
  error: string | null;
}

interface AnkiNote {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  options: { allowDuplicate: boolean; duplicateScope: 'deck' | 'collection' | 'notetype' };
  tags: string[];
}

export interface AnkiExportResult {
  added: number;
  skipped: number;
  failed: number;
  decks: number;
}

export interface AnkiSign {
  description: string;
  videoUrl: string;
  category: string | null;
}

export async function ankiInvoke<T = unknown>(
  action: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(ANKI_CONNECT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, params, version: 6 })
    });
  } catch {
    throw new AnkiConnectionError(ANKI_CONNECTION_ERROR);
  }
  if (!resp.ok) {
    throw new AnkiConnectionError(`${ANKI_CONNECTION_ERROR} (HTTP ${resp.status})`);
  }
  let data: AnkiConnectResponse<T>;
  try {
    data = (await resp.json()) as AnkiConnectResponse<T>;
  } catch {
    throw new AnkiError('AnkiConnect returned an unexpected response.');
  }
  if (data.error) throw new AnkiError(data.error);
  return data.result;
}

async function ensureNoteModel(): Promise<string> {
  const names = (await ankiInvoke<string[]>('modelNames')) ?? [];
  let fallback: string | null = null;
  for (const name of names) {
    const fields = (await ankiInvoke<string[]>('modelFieldNames', { modelName: name })) ?? [];
    if (!fields.includes('Front') || !fields.includes('Back')) continue;
    if (name === 'Basic') return name;
    fallback = fallback ?? name;
  }
  if (fallback) return fallback;
  if (!names.includes('Basic')) {
    await createBasicModel('Basic');
    return 'Basic';
  }
  await createBasicModel('Norsk Tegnspråk Basic');
  return 'Norsk Tegnspråk Basic';
}

async function createBasicModel(modelName: string): Promise<void> {
  await ankiInvoke('createModel', {
    modelName,
    inOrderFields: ['Front', 'Back'],
    css: '.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }',
    isCloze: false,
    cardTemplates: [
      {
        Name: 'Card 1',
        Front: '{{Front}}',
        Back: '{{FrontSide}}<hr id=answer>{{Back}}'
      }
    ]
  });
}

export async function storeMediaFileFromUrl(filename: string, url: string): Promise<void> {
  try {
    // Preferred: AnkiConnect downloads the file server-side, avoiding browser
    // CORS restrictions and base64 overhead.
    await ankiInvoke('storeMediaFile', { filename, url });
  } catch (err) {
    if (err instanceof AnkiConnectionError) throw err;
    // Fallback: download in the browser and upload base64-encoded bytes.
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Could not download video ${url} (HTTP ${resp.status})`);
    const bytes = new Uint8Array(await resp.arrayBuffer());
    await ankiInvoke('storeMediaFile', { filename, data: bytesToBase64(bytes) });
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function mediaFilenameFromUrl(url: string): string {
  const last = decodeURIComponent(url.split('/').pop() ?? 'video.mp4');
  const extMatch = last.match(/\.[a-z0-9]{1,5}$/i);
  const ext = (extMatch?.[0] ?? '.mp4').toLowerCase();
  const stem = extMatch ? last.slice(0, -ext.length) : last;
  const safe = stem.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^[._-]+|[._-]+$/g, '') || 'video';
  return `${safe}${ext}`;
}

function uniqueFilename(base: string, used: Map<string, number>): string {
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  if (count === 0) return base;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  return `${stem}-${count + 1}${ext}`;
}

export async function collectSigns(): Promise<AnkiSign[]> {
  const [cards, decks] = await Promise.all([db.cards.toArray(), db.decks.toArray()]);
  const deckNames = new Map(decks.map((d) => [d.id, d.name]));
  const seen = new Set<string>();
  const signs: AnkiSign[] = [];
  for (const card of cards) {
    if (card.state === 'discarded' || !card.videoUrl) continue;
    if (seen.has(card.videoUrl)) continue;
    seen.add(card.videoUrl);
    const deckName = deckNames.get(card.deckId);
    signs.push({
      description: card.description,
      videoUrl: card.videoUrl,
      category: deckName && card.deckId !== UNCATEGORIZED_DECK_ID ? deckName : null
    });
  }
  return signs;
}

interface ExportEntry {
  sign: AnkiSign;
  filename: string;
  front: string;
}

function prepareEntries(signs: AnkiSign[]): ExportEntry[] {
  const wordKey = (sign: AnkiSign): string => sign.description.trim().toLowerCase();
  const categoryKey = (sign: AnkiSign): string => `${wordKey(sign)}\u0000${sign.category ?? ''}`;

  const wordCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  for (const sign of signs) {
    if (!sign.description.trim()) continue;
    wordCounts.set(wordKey(sign), (wordCounts.get(wordKey(sign)) ?? 0) + 1);
    categoryCounts.set(categoryKey(sign), (categoryCounts.get(categoryKey(sign)) ?? 0) + 1);
  }

  const usedFilenames = new Map<string, number>();
  const categoryCounters = new Map<string, number>();
  return signs.map((sign) => {
    const filename = uniqueFilename(mediaFilenameFromUrl(sign.videoUrl), usedFilenames);
    const word = sign.description.trim();
    const fallback = filename.replace(/\.[a-z0-9]{1,5}$/i, '');
    let front = word || fallback;
    if (word && (wordCounts.get(wordKey(sign)) ?? 1) > 1) {
      const seen = (categoryCounters.get(categoryKey(sign)) ?? 0) + 1;
      categoryCounters.set(categoryKey(sign), seen);
      front = sign.category
        ? (categoryCounts.get(categoryKey(sign)) ?? 1) > 1
          ? `${word} (${sign.category} #${seen})`
          : `${word} (${sign.category})`
        : `${word} #${seen}`;
    }
    return { sign, filename, front };
  });
}

export async function exportToAnki(
  onProgress?: (done: number, total: number) => void
): Promise<AnkiExportResult> {
  const signs = await collectSigns();
  if (signs.length === 0) {
    throw new Error('No cards to export. Import the dataset in Settings first.');
  }

  // Deterministic order so disambiguation indexes are stable across exports.
  signs.sort(
    (a, b) =>
      a.description.localeCompare(b.description, 'nb') ||
      (a.category ?? '').localeCompare(b.category ?? '', 'nb') ||
      a.videoUrl.localeCompare(b.videoUrl)
  );

  const modelName = await ensureNoteModel();

  const categories = new Set(signs.map((s) => s.category).filter((c): c is string => c !== null));
  await ankiInvoke('createDeck', { deck: DECK_NAME });
  for (const category of categories) {
    await ankiInvoke('createDeck', { deck: `${DECK_NAME}::${category}` });
  }

  const entries = prepareEntries(signs);

  let added = 0;
  let skipped = 0;
  let failed = 0;
  const notes: AnkiNote[] = [];

  const flush = async (): Promise<void> => {
    if (notes.length === 0) return;
    const batch = notes.splice(0);
    try {
      const canAddList = await ankiInvoke<boolean[] | null>('canAddNotes', { notes: batch });
      const flags = Array.isArray(canAddList) ? canAddList : batch.map(() => true);
      const valid = batch.filter((_, idx) => flags[idx] === true);
      skipped += batch.length - valid.length;
      if (valid.length > 0) {
        const ids = await ankiInvoke<Array<number | null>>('addNotes', { notes: valid });
        for (const id of ids ?? []) {
          if (id === null || id === undefined) skipped++;
          else added++;
        }
      }
    } catch (err) {
      if (err instanceof AnkiConnectionError) throw err;
      skipped += batch.length;
    }
  };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    try {
      await storeMediaFileFromUrl(entry.filename, entry.sign.videoUrl);
      const deck = entry.sign.category ? `${DECK_NAME}::${entry.sign.category}` : DECK_NAME;
      notes.push({
        deckName: deck,
        modelName,
        fields: { Front: entry.front, Back: `[sound:${entry.filename}]` },
        options: { allowDuplicate: true, duplicateScope: 'deck' },
        tags: entry.sign.category
          ? [...NOTE_TAGS, entry.sign.category.replace(/\s+/g, '_')]
          : [...NOTE_TAGS]
      });
    } catch (err) {
      if (err instanceof AnkiConnectionError) throw err;
      failed++;
    }
    onProgress?.(i + 1, entries.length);
    if (notes.length >= ADD_BATCH_SIZE) await flush();
  }
  await flush();

  return { added, skipped, failed, decks: categories.size };
}
