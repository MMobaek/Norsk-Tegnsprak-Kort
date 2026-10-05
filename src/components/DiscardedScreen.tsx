import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { D0 } from '../lib/fsrs';
import type { Card } from '../lib/types';
import { useAppStore } from '../store/appStore';

interface Row {
  card: Card;
  deckName: string;
}

export default function DiscardedScreen() {
  const [rows, setRows] = useState<Row[]>([]);
  const setView = useAppStore((s) => s.setView);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const cards = await db.cards.where('state').equals('discarded').toArray();
    const decks = await db.decks.toArray();
    const nameOf = new Map(decks.map((d) => [d.id, d.name]));
    const list = cards
      .map((c) => ({ card: c, deckName: nameOf.get(c.deckId) ?? c.deckId }))
      .sort((a, b) => a.card.description.localeCompare(b.card.description, 'nb'));
    setRows(list);
  }

  async function restore(card: Card) {
    await db.cards.put({
      ...card,
      state: 'new',
      stepIndex: 0,
      stability: 0,
      difficulty: D0,
      dueTimestamp: Date.now(),
      consecCorrect: 0,
      lapses: 0,
      pendingBandit: undefined
    });
    await load();
  }

  async function remove(card: Card) {
    if (!window.confirm(`Permanently delete "${card.description}" (${card.direction})?`)) return;
    await db.cards.delete(card.id);
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Discarded cards</h1>
        <button className="btn-subtle" onClick={() => setView('settings')}>
          Back to settings
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="card">
          <p className="text-slate-500">No discarded cards.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(({ card, deckName }) => (
            <div
              key={card.id}
              className="card flex items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{card.description}</p>
                <p className="truncate text-sm text-slate-500">
                  {deckName} · {card.direction === 'production' ? 'Production' : 'Comprehension'} ·{' '}
                  {card.reps} reviews
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button className="btn-subtle" onClick={() => void restore(card)}>
                  Restore
                </button>
                <button
                  className="btn-subtle text-rose-600 dark:text-rose-400"
                  onClick={() => void remove(card)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
