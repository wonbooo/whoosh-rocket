export const RATE_TARGET = 0.9;
export const AGILITY_FAST_DAYS = 3;
export const AGILITY_SLOW_DAYS = 15;
export const PRICE_SPIKE = 0.08;
export const RATING_A = 85;
export const RATING_B = 75;

export interface ScoreWeights {
  timeliness: number;
  quality: number;
  scale: number;
  agility: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  timeliness: 0.3,
  quality: 0.3,
  scale: 0.25,
  agility: 0.15,
};
