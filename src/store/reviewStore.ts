import { create } from 'zustand';
import { db } from '../lib/db';
import { getPref, setPref } from '../lib/prefs';
import { processReview } from '../lib/scheduler';
import type { Card, Deck, Rating } from '../lib/types';

interface ReviewState {
  active: boolean;
  busy: boolean;
  deck: Deck | null;
  queue: Card[];
  index: number;
  revealed: boolean;
  done: boolean;
  speed: number;
  loop: boolean;
  showStart: number;
  revealStart: number;
  counts: Record<number, number>;
  startSession: (deckId: string | null) => Promise<void>;
  reveal: () => void;
  rate: (r: Rating) => Promise<void>;
  discard: () => Promise<void>;
  stop: () => void;
  setSpeed: (s: number) => void;
  toggleLoop: () => void;
}

const initial = {
  active: false,
  busy: false,
  deck: null as Deck | null,
  queue: [] as Card[],
  index: 0,
  revealed: false,
  done: false,
  speed: 1,
  loop: true,
  showStart: 0,
  revealStart: 0,
  counts: {} as Record<number, number>
};

export const useReviewStore = create<ReviewState>((set, get) => ({
  ...initial,
  startSession: async (deckId) => {
    const deck = deckId ? ((await db.decks.get(deckId)) ?? null) : null;
    const queue = await fetchDue(deckId, 60);
    set({ ...initial, active: true, deck, queue, index: 0, showStart: performance.now() });
  },
  reveal: () => {
    const s = get();
    if (!s.busy && s.active && !s.done && !s.revealed) {
      set({ revealed: true, revealStart: performance.now() });
    }
  },
  rate: async (rating) => {
    const s = get();
    const card = s.queue[s.index];
    if (!card || !s.revealed || s.busy) return;
    set({ busy: true });
    try {
      const timeToRevealMs = Math.max(0, s.revealStart - s.showStart);
      const timeToRateMs = Math.max(0, performance.now() - s.revealStart);
      await processReview(card, rating, timeToRevealMs, timeToRateMs);
      const counts = { ...s.counts, [rating]: (s.counts[rating] ?? 0) + 1 };
      set({ counts });
      await advance(get, set);
    } finally {
      set({ busy: false });
    }
  },
  discard: async () => {
    const s = get();
    const card = s.queue[s.index];
    if (!card || !s.revealed || s.busy) return;
    set({ busy: true });
    try {
      await db.cards.update(card.id, { state: 'discarded', dueTimestamp: Number.MAX_SAFE_INTEGER });
      await advance(get, set);
    } finally {
      set({ busy: false });
    }
  },
  stop: () => set({ ...initial }),
  setSpeed: (speed) => set({ speed }),
  toggleLoop: () => set((s) => ({ loop: !s.loop }))
}));

type SetState = (partial: Partial<ReviewState>) => void;
type GetState = () => ReviewState;

async function advance(get: GetState, set: SetState): Promise<void> {
  const s = get();
  const nextIndex = s.index + 1;
  if (nextIndex < s.queue.length) {
    set({ index: nextIndex, revealed: false, showStart: performance.now() });
    return;
  }
  const deckId = s.deck ? s.deck.id : null;
  const known = new Set(s.queue.map((c) => c.id));
  const more = await fetchDue(deckId, 60, known);
  if (more.length) {
    set({
      queue: [...s.queue, ...more],
      index: s.queue.length,
      revealed: false,
      showStart: performance.now()
    });
  } else {
    set({ done: true, active: false });
  }
}

async function fetchDue(
  deckId: string | null,
  limit: number,
  exclude?: Set<string>
): Promise<Card[]> {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const perDay = getPref('nts_newPerDay', 20);
  const introRaw = localStorage.getItem('nts_newIntro');
  let budget = perDay;
  let introduced = 0;
  if (introRaw) {
    try {
      const p = JSON.parse(introRaw) as { date: string; count: number };
      introduced = p.date === today ? p.count : 0;
    } catch {
      introduced = 0;
    }
  }
  budget = Math.max(0, budget - introduced);
  let usedNew = 0;

  const all = await db.cards
    .where('state')
    .anyOf('new', 'learning', 'review')
    .filter((c) => c.dueTimestamp <= now && (!deckId || c.deckId === deckId))
    .toArray();
  all.sort((a, b) => a.dueTimestamp - b.dueTimestamp || a.id.localeCompare(b.id));

  const out: Card[] = [];
  for (const c of all) {
    if (exclude?.has(c.id)) continue;
    if (c.state === 'new') {
      if (budget <= 0) continue;
      budget--;
      usedNew++;
    }
    out.push(c);
    if (out.length >= limit) break;
  }
  if (usedNew > 0) {
    setPref('nts_newIntro', { date: today, count: introduced + usedNew });
  }
  return out;
}
