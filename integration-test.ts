import 'fake-indexeddb/auto';
import { db } from './src/lib/db.ts';
import { processReview, STEP_MINUTES } from './src/lib/scheduler.ts';
import { ARMS } from './src/lib/bandit.ts';
import { D0, initialStability } from './src/lib/fsrs.ts';
import type { Card } from './src/lib/types.ts';

const DAY = 86400000;

function newCard(id: string, direction: 'production' | 'comprehension'): Card {
  return {
    id,
    deckId: 'test',
    direction,
    videoUrl: 'https://example.com/v.mp4',
    description: 'test',
    tags: ['test'],
    state: 'new',
    stepIndex: 0,
    stability: 0,
    difficulty: D0,
    dueTimestamp: Date.now(),
    consecCorrect: 0,
    lapses: 0,
    reps: 0
  };
}

async function main() {
  await db.cards.clear();
  await db.review_logs.clear();
  await db.bandit_params.clear();

  let card = newCard('card1', 'production');

  card = await processReview(card, 1, 500, 2000);
  console.log('new + very hard:', card.state, card.stepIndex, card.dueTimestamp - Date.now() > 0);
  if (card.state !== 'learning' || card.stepIndex !== 0) throw new Error('step reset failed');

  card = await processReview(card, 3, 500, 2000);
  console.log('step0 + good:', card.state, card.stepIndex, 'due in', Math.round((card.dueTimestamp - Date.now()) / 60000), 'min');
  if (card.state !== 'learning' || card.stepIndex !== 1) throw new Error('step advance failed');

  card = await processReview(card, 4, 500, 2000);
  console.log('step1 + easy: state =', card.state, 'stability =', card.stability.toFixed(2));
  if (card.state !== 'review') throw new Error('graduation failed');
  const gradStab = card.stability;
  if (Math.abs(gradStab - initialStability(4)) > 1e-9) throw new Error('wrong initial stability');
  if (!card.pendingBandit) throw new Error('missing pending bandit tuple');
  if (!ARMS.includes(card.pendingBandit.action)) throw new Error('invalid arm');
  const scheduledDays = card.pendingBandit.scheduledDays;
  console.log('scheduled:', scheduledDays, 'days, arm', card.pendingBandit.action);
  if (scheduledDays < 1) throw new Error('interval must be at least 1 day');

  card.lastReviewedTimestamp = Date.now() - scheduledDays * DAY;
  card = await processReview(card, 3, 500, 2000);
  console.log('interday + good: stability =', card.stability.toFixed(2), 'state =', card.state);
  if (card.state !== 'review') throw new Error('interday good should stay review');
  if (card.consecCorrect !== 3) throw new Error(`consecutive counter wrong: ${card.consecCorrect}`);
  if (!card.pendingBandit) throw new Error('missing pending after interday');
  console.log('new schedule:', card.pendingBandit.scheduledDays, 'days, arm', card.pendingBandit.action);

  const lapsing = await processReview(card, 1, 500, 2000);
  console.log('interday + very hard: state =', lapsing.state, 'lapses =', lapsing.lapses);
  if (lapsing.state !== 'learning' || lapsing.stepIndex !== 0) throw new Error('lapse should re-enter learning');
  if (lapsing.lapses !== 2) throw new Error(`lapse counter wrong: ${lapsing.lapses}`);
  if (lapsing.pendingBandit) throw new Error('pending tuple should be cleared after review');
  const lapseDueMin = Math.round((lapsing.dueTimestamp - Date.now()) / 60000);
  if (lapseDueMin !== STEP_MINUTES[0]) throw new Error(`lapse due should be ${STEP_MINUTES[0]} min, got ${lapseDueMin}`);

  const logs = await db.review_logs.count();
  console.log('review logs written:', logs);
  if (logs !== 5) throw new Error('expected 5 review logs');

  const armKeys = await db.bandit_params.where('key').startsWith('linucb_').count();
  console.log('bandit param keys persisted:', armKeys);
  if (armKeys === 0) throw new Error('bandit params should be persisted');

  const compCard = newCard('card1-comprehension', 'comprehension');
  const compAfter = await processReview(compCard, 3, 500, 2000);
  console.log('comprehension card independent:', compAfter.state, compAfter.stepIndex);
  if (compAfter.state !== 'learning') throw new Error('comprehension should advance independently');
  const prod = await db.cards.get('card1');
  if (!prod || prod.state !== 'learning' || prod.stepIndex !== 0) throw new Error('production card state leaked');

  console.log('integration: PASS');
}

main().catch((e) => {
  console.error('integration: FAIL', e);
  process.exit(1);
});
