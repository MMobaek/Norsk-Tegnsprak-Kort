import 'fake-indexeddb/auto';

const backing = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (backing.has(k) ? (backing.get(k) as string) : null),
  setItem: (k: string, v: string) => {
    backing.set(k, v);
  },
  removeItem: (k: string) => {
    backing.delete(k);
  },
  clear: () => backing.clear(),
  key: () => null,
  length: 0
};

const { db } = await import('./src/lib/db.ts');
const { useReviewStore } = await import('./src/store/reviewStore.ts');
const { D0 } = await import('./src/lib/fsrs.ts');

async function main() {
  await db.cards.clear();
  await db.cards.add({
    id: 'sess-card-1',
    deckId: 'test',
    direction: 'production',
    videoUrl: 'https://example.com/v.mp4',
    description: 'session test',
    tags: [],
    state: 'new',
    stepIndex: 0,
    stability: 0,
    difficulty: D0,
    dueTimestamp: Date.now(),
    consecCorrect: 0,
    lapses: 0,
    reps: 0
  });

  await useReviewStore.getState().startSession(null);
  let s = useReviewStore.getState();
  if (!s.active || s.queue.length !== 1) throw new Error('session did not start');
  if (!backing.has('nts_session')) throw new Error('session not persisted');

  useReviewStore.getState().reveal();
  s = useReviewStore.getState();
  if (!s.revealed) throw new Error('reveal failed');

  useReviewStore.setState({
    active: false,
    busy: false,
    deck: null,
    queue: [],
    index: 0,
    revealed: false,
    done: false,
    showStart: 0,
    revealStart: 0,
    counts: {}
  });

  const r = await useReviewStore.getState().restoreSession();
  s = useReviewStore.getState();
  if (!r?.restored) throw new Error('restore reported failure');
  if (!s.active) throw new Error('restore did not reactivate session');
  if (s.queue.length !== 1 || s.queue[0].id !== 'sess-card-1') throw new Error('restore lost queue');
  if (!s.revealed) throw new Error('restore lost reveal state');

  useReviewStore.setState({
    active: false,
    busy: false,
    deck: null,
    queue: [],
    index: 0,
    revealed: false,
    done: false,
    showStart: 0,
    revealStart: 0,
    counts: {}
  });

  await useReviewStore.getState().rate(3);
  s = useReviewStore.getState();
  if (s.done || s.active) throw new Error('rate on restored empty state should not schedule');
  if (!backing.has('nts_session')) throw new Error('restored session should remain persisted');

  await useReviewStore.getState().startSession(null);
  s = useReviewStore.getState();
  if (!s.active) throw new Error('second session did not start');
  useReviewStore.getState().stop();
  s = useReviewStore.getState();
  if (s.active || s.done) throw new Error('stop failed');
  if (backing.has('nts_session')) throw new Error('stop should clear persisted session');

  console.log('session persistence: PASS');
}

main().catch((e) => {
  console.error('session persistence: FAIL', e);
  process.exit(1);
});
