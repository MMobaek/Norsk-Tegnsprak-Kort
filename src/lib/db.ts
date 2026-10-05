import Dexie, { Table } from 'dexie';
import type { Card, Deck, ReviewLog } from './types';

interface BanditParam {
  key: string;
  value: unknown;
}

export class NtsDatabase extends Dexie {
  decks!: Table<Deck, string>;
  cards!: Table<Card, string>;
  review_logs!: Table<ReviewLog, number>;
  bandit_params!: Table<BanditParam, string>;

  constructor() {
    super('NtsDatabase');
    this.version(1).stores({
      decks: 'id, parentId, name',
      cards: 'id, deckId, direction, state, dueTimestamp, *tags',
      review_logs: '++id, cardId, timestamp',
      bandit_params: 'key'
    });
  }
}

export const db = new NtsDatabase();
