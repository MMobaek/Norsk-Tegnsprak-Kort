import { useEffect, useRef } from 'react';
import type { Rating } from '../lib/types';
import { useAppStore } from '../store/appStore';
import { useReviewStore } from '../store/reviewStore';
import VideoPlayer from './VideoPlayer';

const RATING_BUTTONS: { r: Rating; label: string; cls: string }[] = [
  { r: 1, label: 'Very hard', cls: 'bg-rose-600 hover:bg-rose-500' },
  { r: 2, label: 'Hard', cls: 'bg-orange-500 hover:bg-orange-400' },
  { r: 3, label: 'Good', cls: 'bg-emerald-600 hover:bg-emerald-500' },
  { r: 4, label: 'Easy', cls: 'bg-sky-600 hover:bg-sky-500' }
];

const SPEEDS = [0.5, 0.75, 1];

export default function ReviewScreen() {
  const store = useReviewStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const setView = useAppStore((s) => s.setView);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const s = useReviewStore.getState();
      if (!s.active || s.done || s.queue.length === 0) return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!s.revealed) {
          s.reveal();
        } else {
          const v = containerRef.current?.querySelector('video');
          if (v) void v.play();
        }
      } else if (s.revealed) {
        if (e.key === 'd' || e.key === 'D') {
          void s.discard();
        } else if (['1', '2', '3', '4'].includes(e.key)) {
          void s.rate(Number(e.key) as Rating);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!store.active && !store.done) return null;

  if (store.done) {
    const total = Object.values(store.counts).reduce((a, b) => a + b, 0);
    return (
      <div className="card mx-auto max-w-md space-y-4 text-center">
        <h2 className="text-xl font-bold">Session complete</h2>
        <p className="text-slate-500">Nothing left to review in this deck right now.</p>
        {total > 0 && (
          <div className="flex justify-center gap-2 text-sm">
            <span className="chip bg-rose-100 text-rose-800">{store.counts[1] ?? 0} very hard</span>
            <span className="chip bg-orange-100 text-orange-800">{store.counts[2] ?? 0} hard</span>
            <span className="chip bg-emerald-100 text-emerald-800">{store.counts[3] ?? 0} good</span>
            <span className="chip bg-sky-100 text-sky-800">{store.counts[4] ?? 0} easy</span>
          </div>
        )}
        <button
          className="btn bg-slate-700 hover:bg-slate-600"
          onClick={() => {
            store.stop();
            setView('home');
          }}
        >
          Back to decks
        </button>
      </div>
    );
  }

  const card = store.queue[store.index];

  if (!card) {
    return (
      <div className="card mx-auto max-w-md space-y-4 text-center">
        <h2 className="text-xl font-bold">Nothing due</h2>
        <p className="text-slate-500">No cards are due in this deck right now.</p>
        <button
          className="btn bg-slate-700 hover:bg-slate-600"
          onClick={() => {
            store.stop();
            setView('home');
          }}
        >
          Back to decks
        </button>
      </div>
    );
  }

  const lookahead = store.queue.slice(store.index + 1, store.index + 3);

  return (
    <div ref={containerRef} className="relative space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-500">
          {store.deck ? store.deck.name : 'All decks'} · {store.index + 1}/{store.queue.length}
        </p>
        <div className="flex items-center gap-1.5">
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={`btn-subtle px-2.5 py-1 text-xs ${
                store.speed === s ? 'bg-slate-200 dark:bg-slate-700' : ''
              }`}
              onClick={() => store.setSpeed(s)}
            >
              {s}x
            </button>
          ))}
          <button
            className="btn-subtle px-2.5 py-1 text-xs"
            onClick={store.toggleLoop}
            title="Toggle looping"
          >
            Loop: {store.loop ? 'on' : 'off'}
          </button>
          <button
            className="btn-subtle px-2.5 py-1 text-xs"
            onClick={() => {
              store.stop();
              setView('home');
            }}
          >
            End
          </button>
        </div>
      </div>

      {lookahead.map((c) => (
        <video
          key={c.id}
          src={c.videoUrl}
          muted
          playsInline
          preload="auto"
          className="pointer-events-none absolute h-px w-px opacity-0"
        />
      ))}

      {!store.revealed ? (
        card.direction === 'production' ? (
          <button
            className="card flex min-h-[60vh] w-full flex-col items-center justify-center gap-5 text-center"
            onClick={store.reveal}
          >
            <p className="px-4 text-3xl font-semibold leading-snug">{card.description}</p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {card.tags.map((t) => (
                <span key={t} className="chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {t}
                </span>
              ))}
            </div>
            <p className="text-sm text-slate-400">Press Space or tap to see the sign</p>
          </button>
        ) : (
          <div className="card flex flex-col items-center gap-4">
            <VideoPlayer
              src={card.videoUrl}
              muted
              loop={store.loop}
              speed={store.speed}
              className="max-h-[55vh] w-auto max-w-full rounded-xl bg-black shadow-md"
            />
            <div className="flex flex-wrap justify-center gap-1.5">
              {card.tags.map((t) => (
                <span key={t} className="chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {t}
                </span>
              ))}
            </div>
            <button className="btn bg-slate-700 hover:bg-slate-600" onClick={store.reveal}>
              Show answer (Space)
            </button>
          </div>
        )
      ) : (
        <div className="card flex flex-col items-center gap-4">
          <VideoPlayer
            src={card.videoUrl}
            muted
            loop={store.loop}
            speed={store.speed}
            className="max-h-[45vh] w-auto max-w-full rounded-xl bg-black shadow-md"
          />
          <p className="px-4 text-center text-2xl font-semibold leading-snug">
            {card.description}
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {card.tags.map((t) => (
              <span key={t} className="chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {t}
              </span>
            ))}
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
            {RATING_BUTTONS.map((b) => (
              <button
                key={b.r}
                className={`btn ${b.cls}`}
                onClick={() => void store.rate(b.r)}
              >
                <span>{b.label}</span>
                <kbd className="rounded bg-black/20 px-1.5 py-0.5 text-xs">{b.r}</kbd>
              </button>
            ))}
          </div>
          <button
            className="btn-subtle text-rose-600 dark:text-rose-400"
            onClick={() => void store.discard()}
          >
            Discard card (D)
          </button>
        </div>
      )}

      <p className="pb-4 text-center text-xs text-slate-400">
        Space: reveal / replay · 1–4: rate · D: discard
      </p>
    </div>
  );
}
