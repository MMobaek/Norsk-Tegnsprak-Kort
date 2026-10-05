export type Direction = 'production' | 'comprehension';
export type Rating = 1 | 2 | 3 | 4;
export type CardState = 'new' | 'learning' | 'review' | 'discarded';

export interface Deck {
  id: string;
  name: string;
  parentId?: string;
}

export interface PendingBandit {
  features: number[];
  action: number;
  scheduledDays: number;
}

export interface Card {
  id: string;
  deckId: string;
  direction: Direction;
  videoUrl: string;
  description: string;
  tags: string[];
  state: CardState;
  stepIndex: number;
  stability: number;
  difficulty: number;
  dueTimestamp: number;
  lastReviewedTimestamp?: number;
  consecCorrect: number;
  lapses: number;
  reps: number;
  pendingBandit?: PendingBandit;
}

export interface ReviewLog {
  id?: number;
  cardId: string;
  timestamp: number;
  rating: Rating;
  elapsedDays: number;
  scheduledDays: number;
  actionTaken: number;
  timeToRevealMs: number;
  timeToRateMs: number;
}

export const DIRECTIONS: Direction[] = ['production', 'comprehension'];
