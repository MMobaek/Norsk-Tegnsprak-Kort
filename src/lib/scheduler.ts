import { db } from './db';
import {
  ARMS,
  buildFeatures,
  chooseAction,
  rewardFor,
  updateArm
} from './bandit';
import {
  baselineInterval,
  initialStability,
  nextDifficulty,
  nextStability,
  retrievability
} from './fsrs';
import type { Card, PendingBandit, Rating } from './types';

export const STEP_MINUTES = [1, 10];
const STEP_MS = STEP_MINUTES.map((m) => m * 60000);
const DAY_MS = 86400000;

interface InterdayResult {
  due: number;
  pending: PendingBandit;
}

export async function processReview(
  card: Card,
  rating: Rating,
  timeToRevealMs: number,
  timeToRateMs: number
): Promise<Card> {
  const now = Date.now();
  const elapsedDays = card.lastReviewedTimestamp
    ? Math.max((now - card.lastReviewedTimestamp) / DAY_MS, 0.0001)
    : 0;
  const pending = card.pendingBandit;

  if (pending) {
    const reward = rewardFor(rating, pending.scheduledDays);
    const armIdx = ARMS.indexOf(pending.action);
    if (armIdx >= 0) await updateArm(armIdx, pending.features, reward);
  }

  const consecCorrect = rating >= 3 ? card.consecCorrect + 1 : 0;
  const lapses = card.lapses + (rating === 1 ? 1 : 0);

  let state = card.state;
  let stepIndex = card.stepIndex;
  let stability = card.stability;
  let difficulty = card.difficulty;
  let due = now;
  let nextPending: PendingBandit | undefined;

  if (card.state === 'new' || card.state === 'learning') {
    if (rating === 1) {
      state = 'learning';
      stepIndex = 0;
      due = now + STEP_MS[0];
    } else {
      const nextStep = stepIndex + 1;
      if (nextStep >= STEP_MS.length) {
        stability = graduateStability(card, rating, stability, elapsedDays);
        const res = await scheduleInterday(
          card,
          stability,
          consecCorrect,
          lapses,
          timeToRevealMs,
          now
        );
        state = 'review';
        due = res.due;
        nextPending = res.pending;
      } else {
        state = 'learning';
        stepIndex = nextStep;
        due = now + STEP_MS[nextStep];
      }
    }
  } else if (card.state === 'review') {
    const r = retrievability(elapsedDays, stability);
    difficulty = nextDifficulty(difficulty, rating);
    if (rating === 1) {
      stability = nextStability(difficulty, stability, r, 1);
      state = 'learning';
      stepIndex = 0;
      due = now + STEP_MS[0];
    } else {
      stability = nextStability(difficulty, stability, r, rating);
      const res = await scheduleInterday(
        card,
        stability,
        consecCorrect,
        lapses,
        timeToRevealMs,
        now
      );
      state = 'review';
      due = res.due;
      nextPending = res.pending;
    }
  }

  await db.review_logs.add({
    cardId: card.id,
    timestamp: now,
    rating,
    elapsedDays,
    scheduledDays: pending?.scheduledDays ?? 0,
    actionTaken: pending?.action ?? 0,
    timeToRevealMs,
    timeToRateMs
  });

  const updated: Card = {
    ...card,
    state,
    stepIndex,
    stability,
    difficulty,
    dueTimestamp: due,
    lastReviewedTimestamp: now,
    consecCorrect,
    lapses,
    reps: card.reps + 1,
    pendingBandit: nextPending
  };
  await db.cards.put(updated);
  return updated;
}

function graduateStability(
  card: Card,
  rating: Rating,
  stability: number,
  elapsedDays: number
): number {
  if (stability <= 0) return initialStability(rating);
  const r = retrievability(elapsedDays, stability);
  return nextStability(card.difficulty, stability, r, rating);
}

async function scheduleInterday(
  card: Card,
  stability: number,
  consecCorrect: number,
  lapses: number,
  timeToRevealMs: number,
  now: number
): Promise<InterdayResult> {
  const base = baselineInterval(stability);
  const x = buildFeatures(card.direction, stability, consecCorrect, lapses, timeToRevealMs);
  const armIdx = await chooseAction(x);
  const multiplier = ARMS[armIdx];
  const interval = Math.max(1, Math.round(base * multiplier));
  const due = now + interval * DAY_MS;
  return {
    due,
    pending: { features: x, action: multiplier, scheduledDays: interval }
  };
}

export function secondsUntil(dueTimestamp: number): number {
  return Math.max(0, Math.ceil((dueTimestamp - Date.now()) / 1000));
}
