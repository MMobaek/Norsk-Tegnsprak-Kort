export const FACTOR = 19 / 81;
export const DECAY = -0.5;
export const TARGET_RETENTION = 0.9;

export const W = [
  0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29,
  2.61
];

export const D0 = W[4];

export function retrievability(elapsedDays: number, stability: number): number {
  return Math.pow(1 + (FACTOR * elapsedDays) / Math.max(stability, 0.01), DECAY);
}

export function baselineInterval(stability: number): number {
  return (Math.max(stability, 0.01) / FACTOR) * (Math.pow(TARGET_RETENTION, 1 / DECAY) - 1);
}

export function initialStability(rating: number): number {
  return W[Math.max(0, Math.min(3, rating - 1))];
}

export function nextDifficulty(difficulty: number, rating: number): number {
  const dPrime = difficulty - W[6] * (rating - 3);
  const clamped = Math.min(10, Math.max(1, dPrime));
  return W[7] * D0 + (1 - W[7]) * clamped;
}

export function nextStability(
  difficulty: number,
  stability: number,
  retrievabilityValue: number,
  rating: number
): number {
  if (rating === 1) {
    return (
      W[11] *
      Math.pow(difficulty, -W[12]) *
      (Math.pow(stability + 1, W[13]) - 1) *
      Math.exp(W[14] * (1 - retrievabilityValue))
    );
  }
  const hardPenalty = rating === 2 ? W[15] : 1;
  const easyBonus = rating === 4 ? W[16] : 1;
  return (
    stability *
    (1 +
      Math.exp(W[8]) *
        (11 - difficulty) *
        Math.pow(Math.max(stability, 0.01), -W[9]) *
        (Math.exp(W[10] * (1 - retrievabilityValue)) - 1) *
        hardPenalty *
        easyBonus)
  );
}
