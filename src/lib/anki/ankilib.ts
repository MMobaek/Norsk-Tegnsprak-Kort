import type initSqlJs from 'sql.js';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { sha256Hex } from '../hash';

export interface AnkiCardSource {
  id: string;
  direction: 'production' | 'comprehension';
  description: string;
  video: string;
  tags: string[];
}

export interface MediaEntry {
  archivedName: string;
  filename: string;
  bytes: Uint8Array;
}

export const ROOT_DECK = 'Norsk tegnspråk';
export const MODEL_NAME = 'Norsk Tegnsprak (RL)';
const FALLBACK_CATEGORY = 'Diverse';
const MODEL_ID = 1765000001;
const DECK_ROOT_ID = 1;
const SEP = '\x1f';
const MAX_ID = 2147483647;

const BASE91 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';

export function deckCategoryName(tag: string): string {
  const s = tag
    .trim()
    .replace(/\//g, ' og ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return FALLBACK_CATEGORY;
  const words = s.split(' ');
  return [words[0].charAt(0).toUpperCase() + words[0].slice(1), ...words.slice(1)].join(' ');
}

export function sanitizeAnkiTag(tag: string): string {
  return tag.replace(/\s+/g, '_').replace(/^#/, '');
}

export function guidFromHash(hashHex: string): string {
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) bytes[i] = parseInt(hashHex.slice(i * 2, i * 2 + 2), 16);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out += BASE91[Number(n % 91n)];
    n /= 91n;
  }
  out = out.split('').reverse().join('');
  while (out.length < 10) out = BASE91[0] + out;
  return out;
}

class IdAllocator {
  private used = new Set<number>();

  next(hashHex: string, offset: number): number {
    let v = parseInt(hashHex.slice(offset * 8, offset * 8 + 8), 16) & 0x7fffffff;
    if (v === 0) v = 1;
    let guard = 0;
    while (this.used.has(v) && guard < 100000) {
      v = v >= MAX_ID ? 1 : v + 1;
      guard++;
    }
    this.used.add(v);
    return v;
  }
}

async function fieldChecksum(field: string): Promise<number> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(field));
  const b = new Uint8Array(buf);
  return (((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0);
}

const CSS = `
.card {
  font-family: "Helvetica Neue", Arial, sans-serif;
  font-size: 20px;
  text-align: center;
  color: #111827;
  background-color: #ffffff;
  padding: 1.2em 1em;
}
h1 {
  font-size: 1.7em;
  line-height: 1.3;
  margin: 0.6em 0;
}
.cat {
  display: inline-block;
  padding: 0.2em 0.8em;
  border-radius: 999px;
  background-color: #e8f0fe;
  color: #1a56db;
  font-size: 0.75em;
  margin-bottom: 0.6em;
}
.prompt {
  color: #8a8a8a;
  font-size: 0.9em;
  margin-top: 1.4em;
}
.sign-video {
  width: 100%;
  max-width: 640px;
  max-height: 50vh;
  border-radius: 8px;
  background-color: #000;
  object-fit: contain;
  margin: 0.75em auto;
  display: block;
}
hr#answer {
  border: 0;
  border-top: 1px solid #d1d5db;
  margin: 1em 0;
}
.nightMode .card {
  background-color: #1e1e1e;
  color: #ececec;
}
.nightMode .cat {
  background-color: #1a3a6b;
  color: #9cc3ff;
}
`;

const TMPL_PRODUKSJON = {
  name: 'Produksjon',
  ord: 0,
  qfmt: `<div class="card">
<div class="cat">{{Category}}</div>
<h1>{{Description}}</h1>
<p class="prompt">Vis tegnet for ordet over.</p>
</div>`,
  afmt: `{{FrontSide}}
<hr id="answer" />
<div class="card">
<video class="sign-video" src="{{Video}}" autoplay loop muted playsinline controls>
Nettleseren din støtter ikke video.
</video>
</div>`,
  did: null,
  bqfmt: '',
  bafmt: '',
  bfont: '',
  bsize: 0
};

const TMPL_FORSTAELSE = {
  name: 'Forståelse',
  ord: 1,
  qfmt: `<div class="card">
<div class="cat">{{Category}}</div>
<video class="sign-video" src="{{Video}}" autoplay loop muted playsinline controls>
Nettleseren din støtter ikke video.
</video>
<p class="prompt">Hva betyr dette tegnet?</p>
</div>`,
  afmt: `{{FrontSide}}
<hr id="answer" />
<div class="card">
<h1>{{Description}}</h1>
</div>`,
  did: null,
  bqfmt: '',
  bafmt: '',
  bfont: '',
  bsize: 0
};

const LATEX_PRE = `\\documentclass[12pt]{article}
\\special{papersize=3in,5in}
\\usepackage[utf8]{inputenc}
\\usepackage{amssymb,amsmath}
\\pagestyle{empty}
\\setlength{\\parindent}{0in}
\\begin{document}
`;

const DDL = `CREATE TABLE col (
    id integer primary key,
    crt integer not null,
    mod integer not null,
    scm integer not null,
    ver integer not null,
    dty integer not null,
    usn integer not null,
    ls integer not null,
    conf text not null,
    models text not null,
    decks text not null,
    dconf text not null,
    tags text not null
);
CREATE TABLE notes (
    id integer primary key,
    guid text not null,
    mid integer not null,
    mod integer not null,
    usn integer not null,
    tags text not null,
    flds text not null,
    sfld integer not null,
    csum integer not null,
    flags integer not null,
    data text not null
);
CREATE TABLE cards (
    id integer primary key,
    nid integer not null,
    did integer not null,
    ord integer not null,
    mod integer not null,
    usn integer not null,
    type integer not null,
    queue integer not null,
    due integer not null,
    ivl integer not null,
    factor integer not null,
    reps integer not null,
    lapses integer not null,
    left integer not null,
    odue integer not null,
    odid integer not null,
    flags integer not null,
    data text not null
);
CREATE TABLE revlog (
    id integer primary key,
    cid integer not null,
    usn integer not null,
    ease integer not null,
    ivl integer not null,
    lastIvl integer not null,
    factor integer not null,
    time integer not null,
    type integer not null
);
CREATE TABLE graves (
    usn integer not null,
    oid integer not null,
    type integer not null
);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

function deckEntry(id: number, name: string, mod: number): Record<string, unknown> {
  return {
    id,
    name,
    mod,
    usn: -1,
    lrnToday: [0, 0],
    revToday: [0, 0],
    newToday: [0, 0],
    timeToday: [0, 0],
    collapsed: false,
    browserCollapsed: false,
    desc: '',
    dyn: 0,
    conf: 1,
    extendNew: 10,
    extendRev: 50
  };
}

const DCONF = {
  '1': {
    id: 1,
    name: 'Default',
    mod: 0,
    usn: -1,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    new: {
      bury: false,
      delays: [1, 10],
      initialFactor: 2500,
      ints: [1, 4, 7],
      order: 1,
      perDay: 20,
      separate: true
    },
    rev: {
      bury: false,
      ease4: 1.3,
      fuzz: 0.05,
      ivlFct: 1,
      maxIvl: 36500,
      minSpace: 1,
      perDay: 100
    },
    lapse: {
      delays: [10],
      leechAction: 1,
      leechFails: 8,
      minInt: 1,
      mult: 0
    },
    dyn: false
  }
};

export async function buildCollectionDb(
  SQL: initSqlJs.SqlJsStatic,
  cards: AnkiCardSource[],
  onProgress?: (done: number, total: number) => void
): Promise<Uint8Array> {
  const db = new SQL.Database();
  const nowSec = Math.floor(Date.now() / 1000);
  db.run(DDL);

  const allocator = new IdAllocator();
  const deckIds = new Map<string, number>();
  deckIds.set(ROOT_DECK, DECK_ROOT_ID);

  for (const c of cards) {
    const category = deckCategoryName(c.tags[0] ?? '');
    const path = `${ROOT_DECK}::${category}`;
    if (!deckIds.has(path)) {
      const h = await sha256Hex(path);
      deckIds.set(path, allocator.next(h, 0));
    }
  }

  const decks: Record<string, unknown> = {};
  decks[String(DECK_ROOT_ID)] = deckEntry(DECK_ROOT_ID, ROOT_DECK, nowSec);
  for (const [path, id] of deckIds) {
    if (id === DECK_ROOT_ID) continue;
    decks[String(id)] = deckEntry(id, path, nowSec);
  }

  const model = {
    id: MODEL_ID,
    name: MODEL_NAME,
    type: 0,
    mod: nowSec,
    usn: -1,
    sortf: 2,
    did: DECK_ROOT_ID,
    tmpls: [TMPL_PRODUKSJON, TMPL_FORSTAELSE],
    flds: [
      { name: 'Id', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
      { name: 'Direction', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
      { name: 'Description', ord: 2, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
      { name: 'Video', ord: 3, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
      { name: 'Category', ord: 4, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] }
    ],
    css: CSS,
    latexPre: LATEX_PRE,
    latexPost: '\\end{document}',
    latexsvg: false,
    req: [
      [0, 'any', [2]],
      [1, 'any', [2, 3]]
    ],
    tags: [],
    vers: []
  };

  const conf = {
    activeDecks: [DECK_ROOT_ID],
    curDeck: DECK_ROOT_ID,
    newSpread: 0,
    collapseTime: 1200,
    timeLim: 0,
    estTimes: true,
    dueCounts: true,
    curModel: MODEL_ID,
    nextPos: 1,
    sortType: 'noteFld',
    sortBackwards: false,
    addToCur: true,
    dayLearnFirst: false
  };

  db.run(
    `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
     VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')`,
    [
      nowSec,
      nowSec,
      nowSec,
      JSON.stringify(conf),
      JSON.stringify({ [MODEL_ID]: model }),
      JSON.stringify(decks),
      JSON.stringify(DCONF)
    ]
  );

  const insNote = db.prepare(
    `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
     VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')`
  );
  const insCard = db.prepare(
    `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
     VALUES (?, ?, ?, ?, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')`
  );

  db.run('BEGIN TRANSACTION');
  const cardIds = new Set<number>();
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const category = deckCategoryName(c.tags[0] ?? '');
    const deckPath = `${ROOT_DECK}::${category}`;
    const did = deckIds.get(deckPath) ?? DECK_ROOT_ID;
    const direction = c.direction === 'production' ? 'Production' : 'Comprehension';
    const flds = [c.id, direction, c.description, c.video, c.tags.join(', ')].join(SEP);
    const csum = await fieldChecksum(c.id);

    const noteId = allocator.next(c.id, 0);
    const guid = guidFromHash(c.id);
    const noteTags = c.tags.map(sanitizeAnkiTag).filter(Boolean).join(' ');
    insNote.run([noteId, guid, MODEL_ID, nowSec, noteTags, flds, c.description, csum]);

    let cardId = allocator.next(c.id, 1);
    while (cardIds.has(cardId)) {
      cardId = cardId >= MAX_ID ? 1 : cardId + 1;
    }
    cardIds.add(cardId);
    insCard.run([cardId, noteId, did, c.direction === 'production' ? 0 : 1, nowSec, noteId]);

    if (i % 500 === 0 || i === cards.length - 1) onProgress?.(i + 1, cards.length);
  }
  db.run('COMMIT');
  insNote.free();
  insCard.free();

  const bytes = db.export();
  db.close();
  return bytes;
}

export class ApkgZip {
  private zip: Zip;
  private parts: Blob[] = [];
  private media: { archivedName: string; filename: string }[] = [];
  private donePromise: Promise<Blob>;
  private resolve!: (b: Blob) => void;
  private reject!: (e: unknown) => void;

  constructor() {
    this.donePromise = new Promise<Blob>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
    this.zip = new Zip((err, chunk, final) => {
      if (err) {
        this.reject(err);
        return;
      }
      if (chunk) this.parts.push(new Blob([new Uint8Array(chunk)]));
      if (final) this.resolve(new Blob(this.parts, { type: 'application/zip' }));
    });
  }

  addMediaEntry(filename: string, bytes: Uint8Array): void {
    const archivedName = String(this.media.length);
    this.media.push({ archivedName, filename });
    const file = new ZipPassThrough(archivedName);
    this.zip.add(file);
    file.push(bytes, true);
  }

  finish(dbBytes: Uint8Array): Promise<Blob> {
    const mediaMap: Record<string, string> = {};
    for (const m of this.media) mediaMap[m.archivedName] = m.filename;
    const dbFile = new ZipDeflate('collection.anki2', { level: 6 });
    this.zip.add(dbFile);
    dbFile.push(dbBytes, true);
    const mediaFile = new ZipDeflate('media', { level: 6 });
    this.zip.add(mediaFile);
    mediaFile.push(new TextEncoder().encode(JSON.stringify(mediaMap)), true);
    this.zip.end();
    return this.donePromise;
  }
}

export async function buildApkgBlob(
  dbBytes: Uint8Array,
  media: MediaEntry[]
): Promise<Blob> {
  const zip = new ApkgZip();
  for (const m of media) zip.addMediaEntry(m.filename, m.bytes);
  return zip.finish(dbBytes);
}
