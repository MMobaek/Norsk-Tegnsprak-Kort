import { useEffect } from 'react';
import DeckScreen from './components/DeckScreen';
import DiscardedScreen from './components/DiscardedScreen';
import ReviewScreen from './components/ReviewScreen';
import SettingsScreen from './components/SettingsScreen';
import { applyTheme, useAppStore } from './store/appStore';
import { useReviewStore } from './store/reviewStore';

export default function App() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const dark = useAppStore((s) => s.dark);
  const hc = useAppStore((s) => s.hc);
  const setDark = useAppStore((s) => s.setDark);
  const setHc = useAppStore((s) => s.setHc);
  const reviewing = useReviewStore((s) => s.active || s.done);

  useEffect(() => {
    applyTheme();
  }, [dark, hc]);

  const navBtn = (active: boolean) =>
    `btn-subtle ${active ? 'bg-slate-200 dark:bg-slate-700' : ''}`;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
          <button
            className="text-lg font-bold tracking-tight"
            onClick={() => {
              useReviewStore.getState().stop();
              setView('home');
            }}
          >
            Tegnspråksøving
          </button>
          {!reviewing && (
            <div className="flex items-center gap-1.5">
              <button className={navBtn(view === 'home')} onClick={() => setView('home')}>
                Decks
              </button>
              <button
                className={navBtn(view === 'settings')}
                onClick={() => setView('settings')}
              >
                Settings
              </button>
              <button
                className={navBtn(false)}
                onClick={() => setDark(!dark)}
                title="Toggle dark mode"
              >
                {dark ? 'Light' : 'Dark'}
              </button>
              <button
                className={navBtn(hc)}
                onClick={() => setHc(!hc)}
                title="Toggle high contrast mode"
              >
                HC
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        {view === 'review' || reviewing ? (
          <ReviewScreen />
        ) : view === 'settings' ? (
          <SettingsScreen />
        ) : view === 'discarded' ? (
          <DiscardedScreen />
        ) : (
          <DeckScreen />
        )}
      </main>
    </div>
  );
}
