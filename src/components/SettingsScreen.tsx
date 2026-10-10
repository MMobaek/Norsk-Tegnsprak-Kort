import { useEffect, useRef, useState } from 'react';
import { RATING_SCORES, resetBandit, rewardFor } from '../lib/bandit';
import { db } from '../lib/db';
import { D0 } from '../lib/fsrs';
import { importDataset, type ImportResult } from '../lib/importData';
import type { CardState } from '../lib/types';
import { useAppStore } from '../store/appStore';
import { useReviewStore } from '../store/reviewStore';

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
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [backupErr, setBackupErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [ankiBusy, setAnkiBusy] = useState(false);
  const [ankiProgress, setAnkiProgress] = useState<{
    phase: 'videos' | 'build';
    done: number;
    total: number;
  } | null>(null);
  const [ankiMsg, setAnkiMsg] = useState<string | null>(null);
  const [ankiErr, setAnkiErr] = useState<string | null>(null);

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

  async function runTsvExport() {
    setAnkiMsg(null);
    setAnkiErr(null);
    try {
      const { buildAnkiTsv, downloadTextFile, ANKI_TSV_FILENAME } = await import(
        '../lib/anki/exportTsv'
      );
      const cards = await db.cards.toArray();
      const { content, rows } = buildAnkiTsv(cards);
      downloadTextFile(content, ANKI_TSV_FILENAME);
      setAnkiMsg(
        `Eksporterte ${rows} ord til ${ANKI_TSV_FILENAME}. Videoer strømmes fra minetegn.no.`
      );
    } catch (err) {
      setAnkiErr(err instanceof Error ? err.message : String(err));
    }
  }

  async function runAnkiExport() {
    setAnkiBusy(true);
    setAnkiMsg(null);
    setAnkiErr(null);
    setAnkiProgress(null);
    try {
      const { exportApkg, downloadApkg, APKG_FILENAME } = await import('../lib/anki/exportApkg');
      const cards = await db.cards.filter((c) => c.state !== 'discarded').toArray();
      const uniqueVideos = new Set(
        cards.map((c) => c.videoUrl.split('/').pop() ?? c.videoUrl)
      ).size;
      if (
        uniqueVideos > 0 &&
        !window.confirm(
          `Eksporten vil laste ned ${uniqueVideos} unike videoer fra minetegn.no (kan ta lang tid). Fortsette?`
        )
      ) {
        return;
      }
      const res = await exportApkg(setAnkiProgress);
      downloadApkg(res.blob);
      const mb = (res.totalVideoBytes / (1024 * 1024)).toFixed(1);
      let msg = `Eksporterte ${res.cards} kort (${res.notes} noter) i ${res.decks} dekk med ${res.videos} videoer (${mb} MB). Fil: ${APKG_FILENAME}`;
      if (res.videoFailures > 0) {
        msg += ` ${res.videoFailures} videoer kunne ikke lastes ned.`;
      }
      setAnkiMsg(msg);
    } catch (err) {
      setAnkiErr(err instanceof Error ? err.message : String(err));
    } finally {
      setAnkiBusy(false);
      setAnkiProgress(null);
    }
  }

  async function exportBackup() {
    setBackupMsg(null);
    setBackupErr(null);
    try {
      const [decks, cards, logs, params] = await Promise.all([
        db.decks.toArray(),
        db.cards.toArray(),
        db.review_logs.toArray(),
        db.bandit_params.toArray()
      ]);
      const payload = {
        app: 'tegnsproeving',
        version: 1,
        exportedAt: new Date().toISOString(),
        decks,
        cards,
        logs,
        params
      };
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tegnsproeving-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupMsg(`Exported ${cards.length} cards and ${logs.length} review logs.`);
    } catch (err) {
      setBackupErr(err instanceof Error ? err.message : String(err));
    }
  }

  async function importBackup(file: File) {
    setBackupMsg(null);
    setBackupErr(null);
    try {
      const payload = JSON.parse(await file.text()) as {
        app?: string;
        decks?: unknown[];
        cards?: unknown[];
        logs?: unknown[];
        params?: unknown[];
      };
      if (!payload || payload.app !== 'tegnsproeving' || !Array.isArray(payload.cards)) {
        throw new Error('Not a valid Tegnspråksøving backup file');
      }
      useReviewStore.getState().stop();
      await db.transaction('rw', [db.decks, db.cards, db.review_logs, db.bandit_params], async () => {
        await db.decks.clear();
        await db.cards.clear();
        await db.review_logs.clear();
        await db.bandit_params.clear();
        await db.decks.bulkPut((payload.decks ?? []) as never[]);
        await db.cards.bulkPut((payload.cards ?? []) as never[]);
        await db.review_logs.bulkAdd((payload.logs ?? []) as never[]);
        await db.bandit_params.bulkPut((payload.params ?? []) as never[]);
      });
      localStorage.removeItem('nts_newIntro');
      setBackupMsg('Backup restored.');
      await loadStats();
    } catch (err) {
      setBackupErr(err instanceof Error ? err.message : String(err));
    }
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

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">Backup</h2>
        <p className="text-sm text-slate-500">
          Progress is stored locally in your browser and resumes automatically. Export a backup
          file to keep your progress safe or move it to another browser.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-subtle" onClick={() => void exportBackup()}>
            Export backup
          </button>
          <button
            className="btn-subtle"
            onClick={() => {
              if (
                window.confirm(
                  'Importing a backup replaces all current cards, logs and settings. Continue?'
                )
              ) {
                fileInputRef.current?.click();
              }
            }}
          >
            Import backup
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importBackup(f);
              e.target.value = '';
            }}
          />
        </div>
        {backupMsg && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">{backupMsg}</p>
        )}
        {backupErr && <p className="text-sm text-rose-600 dark:text-rose-400">{backupErr}</p>}
      </section>

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">Anki-eksport</h2>
        <p className="text-sm text-slate-500">
          Laster ned en tab-separert tekstfil (.txt) klar for import i Anki. Videoene strømmes
          direkte fra minetegn.no og spilles av med HTML5
          (<code className="rounded bg-slate-100 px-1 dark:bg-slate-800">&lt;video&gt;</code>), så
          ingen lokale filer trengs. Én rad per tegn; både Produksjon (ord → video) og Forståelse
          (video → ord) opprettes fra notetypen under import.
        </p>
        <button className="btn bg-slate-700 hover:bg-slate-600" onClick={() => void runTsvExport()}>
          Export to Anki (.txt, streaming)
        </button>
        <button className="btn-subtle" onClick={() => void runAnkiExport()} disabled={ankiBusy}>
          {ankiBusy ? 'Genererer Anki-pakke…' : 'Eksporter til Anki (.apkg, med nedlastede videoer)'}
        </button>
        {ankiProgress && (
          <div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="h-full bg-slate-600 transition-all"
                style={{
                  width: `${Math.round((ankiProgress.done / Math.max(ankiProgress.total, 1)) * 100)}%`
                }}
              />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {ankiProgress.phase === 'videos'
                ? `Laster ned videoer: ${ankiProgress.done}/${ankiProgress.total}...`
                : `Genererer Anki-pakke… ${ankiProgress.done}/${ankiProgress.total} kort`}
            </p>
          </div>
        )}
        {ankiMsg && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">{ankiMsg}</p>
        )}
        {ankiErr && <p className="text-sm text-rose-600 dark:text-rose-400">{ankiErr}</p>}
        <details className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
          <summary className="cursor-pointer font-medium">Oppsett i Anki (notetype, maler og import)</summary>
          <div className="mt-3 space-y-3 text-slate-600 dark:text-slate-300">
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-100">1. Opprett notetypen</p>
              <p>
                Tools → Manage Note Types → Add → velg <em>Basic (and reversed card)</em> og gi den
                navnet <em>Norsk tegnspråk (video)</em>. I <em>Fields…</em> endrer du feltene til
                (i denne rekkefølgen): <code>Word</code>, <code>VideoURL</code>, <code>Category</code>,{' '}
                <code>Notes</code>, og setter sorteringsfeltet til <code>Word</code>.
              </p>
            </div>
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-100">2. Lim inn malene</p>
              <p className="mb-1">Card 1 (Produksjon):</p>
              <pre className="overflow-x-auto rounded bg-slate-100 p-2 text-xs dark:bg-slate-800">{`Front:
<div class="card">
<div class="cat">{{Category}}</div>
<h1>{{Word}}</h1>
<p class="prompt">Vis tegnet for ordet over.</p>
</div>

Back:
{{FrontSide}}
<hr id="answer" />
<div class="card">
<video class="sign-video" src="{{VideoURL}}" autoplay loop muted playsinline controls>
Din nettleser støtter ikke video.
</video>
</div>`}</pre>
              <p className="mb-1 mt-2">Card 2 (Forståelse):</p>
              <pre className="overflow-x-auto rounded bg-slate-100 p-2 text-xs dark:bg-slate-800">{`Front:
<div class="card">
<div class="cat">{{Category}}</div>
<video class="sign-video" src="{{VideoURL}}" autoplay loop muted playsinline controls>
Din nettleser støtter ikke video.
</video>
<p class="prompt">Hva betyr dette tegnet?</p>
</div>

Back:
{{FrontSide}}
<hr id="answer" />
<div class="card">
<h1>{{Word}}</h1>
</div>`}</pre>
            </div>
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-100">3. Lim inn CSS (Styling)</p>
              <pre className="overflow-x-auto rounded bg-slate-100 p-2 text-xs dark:bg-slate-800">{`.card {
  font-family: "Helvetica Neue", Arial, sans-serif;
  font-size: 20px;
  text-align: center;
  color: #111827;
  background-color: #ffffff;
  padding: 1em;
}
h1 { font-size: 1.7em; line-height: 1.3; margin: 0.6em 0; }
.cat { display: inline-block; padding: 0.2em 0.8em; border-radius: 999px;
  background-color: #e8f0fe; color: #1a56db; font-size: 0.75em; margin-bottom: 0.6em; }
.prompt { color: #8a8a8a; font-size: 0.9em; margin-top: 1.4em; }
.sign-video { display: block; width: 100%; max-width: 640px; max-height: 50vh;
  object-fit: contain; border-radius: 8px; background-color: #000; margin: 0.75em auto; }
hr#answer { border: 0; border-top: 1px solid #d1d5db; margin: 1em 0; }
.nightMode .card { background-color: #1e1e1e; color: #ececec; }
.nightMode .cat { background-color: #1a3a6b; color: #9cc3ff; }`}</pre>
            </div>
            <div>
              <p className="font-semibold text-slate-800 dark:text-slate-100">4. Importer .txt-filen</p>
              <ul className="list-inside list-disc space-y-1">
                <li>File → Import → velg <code>Norsk_tegnsprak_export.txt</code></li>
                <li>Type: <em>Norsk tegnspråk (video)</em> · Deck: velg eller opprett <em>Norsk tegnspråk</em></li>
                <li><strong>Field separator: Tab</strong></li>
                <li><strong>Allow HTML in fields: av</strong> (feltene er ren tekst)</li>
                <li>Feltmapping (rad 1 under overskriften): 1 → Word, 2 → VideoURL, 3 → Category, 4 → Notes</li>
                <li>Klikk Import. Hver rad gir ett notat med to kort: Produksjon og Forståelse.</li>
              </ul>
              <p className="mt-2">
                Videoene strømmes fra minetegn.no – Anki og AnkiDroid trenger nett for å spille dem.
                Ved gjenimport: velg «Update» for å oppdatere eksisterende notater uten duplikater.
              </p>
            </div>
          </div>
        </details>
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
