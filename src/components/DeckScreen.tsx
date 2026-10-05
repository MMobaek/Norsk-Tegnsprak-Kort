import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import type { Deck } from '../lib/types';
import { useAppStore } from '../store/appStore';
import { useReviewStore } from '../store/reviewStore';

interface Row {
  deck: Deck;
  n: number;
  l: number;
  r: number;
}

export default function DeckScreen() {
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ n: 0, l: 0, r: 0 });
  const [loaded, setLoaded] = useState(false);
  const setView = useAppStore((s) => s.setView);
  const startSession = useReviewStore((s) => s.startSession);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const now = Date.now();
    const [cards, decks] = await Promise.all([db.cards.toArray(), db.decks.toArray()]);
    const perDeck = new Map<string, { n: number; l: number; r: number }>();
    let tn = 0;
    let tl = 0;
    let tr = 0;
    for (const c of cards) {
      if (c.state === 'discarded') continue;
      const entry = perDeck.get(c.deckId) ?? { n: 0, l: 0, r: 0 };
      if (c.state === 'new') {
        entry.n++;
        tn++;
      } else if (c.state === 'learning' && c.dueTimestamp <= now) {
        entry.l++;
        tl++;
      } else if (c.state === 'review' && c.dueTimestamp <= now) {
        entry.r++;
        tr++;
      }
      perDeck.set(c.deckId, entry);
    }
    const list = decks
      .filter((d) => d.parentId)
      .map((d) => ({ deck: d, ...(perDeck.get(d.id) ?? { n: 0, l: 0, r: 0 }) }))
      .filter((row) => row.n + row.l + row.r > 0)
      .sort((a, b) => a.deck.name.localeCompare(b.deck.name, 'nb'));
    setRows(list);
    setTotals({ n: tn, l: tl, r: tr });
    setLoaded(true);
  }

  async function begin(deckId: string | null) {
    await startSession(deckId);
    setView('review');
  }

  const totalDue = totals.n + totals.l + totals.r;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Decks</h1>
        <button
          className="btn-subtle"
          onClick={() => {
            void load();
          }}
        >
          Refresh
        </button>
      </div>

      {!loaded ? (
        <p className="text-slate-500">Loading…</p>
      ) : totalDue === 0 ? (
        <div className="card space-y-3">
          <p className="font-semibold">Nothing to review right now</p>
          <p className="text-sm text-slate-500">
            If you have not imported the dataset yet, head to Settings and run the import.
          </p>
          <button
            className="btn bg-slate-700 hover:bg-slate-600"
            onClick={() => setView('settings')}
          >
            Open Settings
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            className="card flex w-full items-center justify-between text-left transition-shadow hover:shadow-md"
            onClick={() => void begin(null)}
          >
            <div>
              <p className="font-semibold">All decks</p>
              <p className="text-sm text-slate-500">Study everything due</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="chip bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200">
                {totals.n} new
              </span>
              <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                {totals.l} learning
              </span>
              <span className="chip bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                {totals.r} due
              </span>
            </div>
          </button>
          {rows.map((row) => (
            <button
              key={row.deck.id}
              className="card flex w-full items-center justify-between text-left transition-shadow hover:shadow-md"
              onClick={() => void begin(row.deck.id)}
            >
              <p className="font-semibold">{row.deck.name}</p>
              <div className="flex items-center gap-2">
                {row.n > 0 && (
                  <span className="chip bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200">
                    {row.n} new
                  </span>
                )}
                {row.l > 0 && (
                  <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                    {row.l} learning
                  </span>
                )}
                {row.r > 0 && (
                  <span className="chip bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                    {row.r} due
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
