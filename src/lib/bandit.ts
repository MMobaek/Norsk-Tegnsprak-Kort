import { db } from './db';
import { BANDIT_DIM, invert, solve } from './matrix';

export const ARMS = [0.75, 1, 1.25, 1.5, 1.8];
const DIM = BANDIT_DIM;
const RIDGE = 1;
const ALPHA = 0.6;
const PRIOR_SCORES = [0.5, 0.62, 0.56, 0.46, 0.4];

export const RATING_SCORES: Record<number, number> = { 1: -1, 2: -0.4, 3: 0.6, 4: 1 };
export const REWARD_LAMBDA = 0.05;

export function rewardFor(rating: number, scheduledDays: number): number {
  return (RATING_SCORES[rating] ?? 0) - REWARD_LAMBDA / Math.max(scheduledDays, 0.001);
}

export function buildFeatures(
  direction: string,
  stability: number,
  consecCorrect: number,
  lapses: number,
  timeToRevealMs: number
): number[] {
  return [
    1,
    direction === 'production' ? 1 : 0,
    Math.log1p(Math.max(stability, 0.01)) / 7,
    Math.min(Math.max(consecCorrect, 0), 10) / 10,
    Math.min(Math.max(lapses, 0), 20) / 20,
    Math.log1p(Math.max(timeToRevealMs, 0) / 1000) / 10
  ];
}

function armKey(kind: 'a' | 'b', idx: number): string {
  return `linucb_${kind}_${idx}`;
}

async function loadArm(idx: number): Promise<{ A: number[]; b: number[] }> {
  const aEntry = await db.bandit_params.get(armKey('a', idx));
  const bEntry = await db.bandit_params.get(armKey('b', idx));
  const A = aEntry?.value as number[] | undefined;
  const b = bEntry?.value as number[] | undefined;
  if (A && b && A.length === DIM * DIM && b.length === DIM) {
    return { A: A.slice(), b: b.slice() };
  }
  const Ai = new Array<number>(DIM * DIM).fill(0);
  for (let i = 0; i < DIM; i++) Ai[i * DIM + i] = RIDGE;
  const bi = new Array<number>(DIM).fill(0);
  bi[0] = PRIOR_SCORES[idx] * RIDGE;
  return { A: Ai, b: bi };
}

async function saveArm(idx: number, A: number[], b: number[]): Promise<void> {
  await db.bandit_params.put({ key: armKey('a', idx), value: A });
  await db.bandit_params.put({ key: armKey('b', idx), value: b });
}

export async function chooseAction(x: number[]): Promise<number> {
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < ARMS.length; i++) {
    const { A, b } = await loadArm(i);
    const theta = solve(A, b);
    const inv = invert(A);
    let mean = 0;
    let quad = 0;
    for (let r = 0; r < DIM; r++) {
      mean += theta[r] * x[r];
      for (let s = 0; s < DIM; s++) quad += x[r] * inv[r * DIM + s] * x[s];
    }
    const score = mean + ALPHA * Math.sqrt(Math.max(0, quad));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

export async function updateArm(idx: number, x: number[], reward: number): Promise<void> {
  const { A, b } = await loadArm(idx);
  for (let i = 0; i < DIM; i++) {
    b[i] += reward * x[i];
    for (let j = 0; j < DIM; j++) A[i * DIM + j] += x[i] * x[j];
  }
  await saveArm(idx, A, b);
}

export async function resetBandit(): Promise<void> {
  await db.bandit_params.where('key').startsWith('linucb_').delete();
}
