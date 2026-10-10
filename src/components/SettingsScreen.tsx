import { useEffect, useState } from 'react';
import { RATING_SCORES, resetBandit, rewardFor } from '../lib/bandit';
import { db } from '../lib/db';
import { D0 } from '../lib/fsrs';
import { importDataset, type ImportResult } from '../lib/importData';
import type { CardState } from '../lib/types';
import { useAppStore } from '../store/appStore';

interface ArmStat {
  multiplier: number;
  n: number;
  avgScore: number;
  avgReward: number;
}

interface Stats {
  totalCards: number;
  dueNow: number;
  discarded: number;
  totalReviews: number;
  todayReviews: number;
  arms: ArmStat[];
}

export default function SettingsScreen() {
  const setView = useAppStore((s) => s.setView);
  const dark = useAppStore((s) => s.dark);
  const hc = useAppStore((s) => s.hc);
  const setDark = useAppStore((s) => s.setDark);
  const setHc = useAppStore((s) => s.setHc);
  const newPerDay = useAppStore((s) => s.newPerDay);
  const setNewPerDay = useAppStore((s) => s.setNewPerDay);

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    void loadStats();
  }, []);

  async function loadStats() {
    const cards = await db.cards.toArray();
    const now = Date.now();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const totalReviews = await db.review_logs.count();
    const todayReviews = await db.review_logs
      .where('timestamp')
      .aboveOrEqual(startOfDay.getTime())
      .count();
    const dueNow = cards.filter((c) => c.state !== 'discarded' && c.dueTimestamp <= now).length;
    const discarded = cards.filter((c) => c.state === 'discarded').length;
    const logs = await db.review_logs.orderBy('id').reverse().limit(5000).toArray();
    const armMap = new Map<number, { n: number; scoreSum: number; rewardSum: number }>();
    for (const l of logs) {
      if (!l.actionTaken) continue;
      const e = armMap.get(l.actionTaken) ?? { n: 0, scoreSum: 0, rewardSum: 0 };
      e.n++;
      e.scoreSum += RATING_SCORES[l.rating] ?? 0;
      e.rewardSum += rewardFor(l.rating, l.scheduledDays);
      armMap.set(l.actionTaken, e);
    }
    const arms = [...armMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([multiplier, e]) => ({
        multiplier,
        n: e.n,
        avgScore: e.scoreSum / e.n,
        avgReward: e.rewardSum / e.n
      }));
    setStats({ totalCards: cards.length, dueNow, discarded, totalReviews, todayReviews, arms });
  }

  async function runImport() {
    setImporting(true);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const res = await importDataset((done, total) => setProgress({ done, total }));
      setResult(res);
      await loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  async function resetProgress() {
    if (
      !window.confirm(
        'Reset all scheduling progress? Review logs and bandit parameters will be cleared and all cards return to the new state.'
      )
    )
      return;
    const cards = await db.cards.toArray();
    const reset = cards.map((c) => ({
      ...c,
      state: 'new' as CardState,
      stepIndex: 0,
      stability: 0,
      difficulty: D0,
      dueTimestamp: Date.now(),
      lastReviewedTimestamp: undefined,
      consecCorrect: 0,
      lapses: 0,
      reps: 0,
      pendingBandit: undefined
    }));
    await db.transaction('rw', [db.cards, db.review_logs, db.bandit_params], async () => {
      await db.cards.bulkPut(reset);
      await db.review_logs.clear();
      await db.bandit_params.clear();
    });
    localStorage.removeItem('nts_newIntro');
    await loadStats();
  }

  async function clearAll() {
    if (!window.confirm('Delete all data, including cards and review history?')) return;
    await db.delete();
    localStorage.removeItem('nts_newIntro');
    window.location.reload();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">Study</h2>
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm">New cards per day</span>
          <input
            type="number"
            min={1}
            max={500}
            value={newPerDay}
            onChange={(e) => setNewPerDay(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
            className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </label>
      </section>

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">Appearance</h2>
        <div className="flex gap-2">
          <button className="btn-subtle" onClick={() => setDark(!dark)}>
            Dark mode: {dark ? 'on' : 'off'}
          </button>
          <button className="btn-subtle" onClick={() => setHc(!hc)}>
            High contrast: {hc ? 'on' : 'off'}
          </button>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">Dataset</h2>
        <p className="text-sm text-slate-500">
          Imports the minetegn.no dataset (data.php.xml) into local storage. Existing card
          scheduling progress is preserved; new signs are added.
        </p>
        <button className="btn bg-slate-700 hover:bg-slate-600" onClick={() => void runImport()} disabled={importing}>
          {importing ? 'Importing…' : 'Import dataset'}
        </button>
        {progress && (
          <div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="h-full bg-slate-600 transition-all"
                style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {progress.done}/{progress.total} signs
            </p>
          </div>
        )}
        {result && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            Imported {result.items} signs ({result.added} cards added, {result.updated} kept,
            {result.skipped} entries without video skipped, {result.decks} decks).
          </p>
        )}
        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      </section>

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">Statistics</h2>
        {!stats ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-slate-500">Total cards</dt>
                <dd className="text-lg font-semibold">{stats.totalCards}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Due now</dt>
                <dd className="text-lg font-semibold">{stats.dueNow}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Discarded</dt>
                <dd className="text-lg font-semibold">{stats.discarded}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Reviews today</dt>
                <dd className="text-lg font-semibold">{stats.todayReviews}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Reviews total</dt>
                <dd className="text-lg font-semibold">{stats.totalReviews}</dd>
              </div>
            </dl>
            {stats.arms.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">Bandit interval multipliers</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-800">
                      <th className="py-1 pr-2">Multiplier</th>
                      <th className="py-1 pr-2">Uses</th>
                      <th className="py-1 pr-2">Avg score</th>
                      <th className="py-1">Avg reward</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.arms.map((a) => (
                      <tr key={a.multiplier} className="border-b border-slate-100 dark:border-slate-800/60">
                        <td className="py-1 pr-2">{a.multiplier}x</td>
                        <td className="py-1 pr-2">{a.n}</td>
                        <td className="py-1 pr-2">{a.avgScore.toFixed(2)}</td>
                        <td className="py-1">{a.avgReward.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  className="btn-subtle mt-3 text-xs"
                  onClick={() => {
                    void resetBandit().then(loadStats);
                  }}
                >
                  Reset bandit policy to FSRS baseline prior
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">Discarded cards</h2>
        <p className="text-sm text-slate-500">
          Discarded cards keep their review history and can be restored at any time.
        </p>
        <button className="btn-subtle" onClick={() => setView('discarded')}>
          Recover discarded cards ({stats?.discarded ?? 0})
        </button>
      </section>

      <section className="card space-y-4 border-rose-200 dark:border-rose-900">
        <h2 className="text-lg font-semibold text-rose-700 dark:text-rose-400">Danger zone</h2>
        <div className="flex flex-wrap gap-2">
          <button className="btn-subtle" onClick={() => void resetProgress()}>
            Reset progress
          </button>
          <button className="btn bg-rose-600 hover:bg-rose-500" onClick={() => void clearAll()}>
            Delete all data
          </button>
        </div>
      </section>
    </div>
  );
}
