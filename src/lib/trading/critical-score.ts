/**
 * Operational urgency score for the account list payload.
 *
 * The score is deliberately current-state only: it reads live/snapshot risk
 * inputs and never mixes in historical Deal or Position performance. Higher
 * means "look at this account sooner". 100 is the calibrated emergency point:
 * floating equity is down 5% while margin level has reached 100%.
 */
export interface CriticalScoreInput {
  balance: number;
  equity: number;
  floatingPl: number;
  marginLevel: number | null;
  depositLoadPct: number | null;
  openPositionCount: number;
}

const FLOATING_LOSS_FULL_SCORE_PCT = 5;
const FLOATING_LOSS_SCORE_WEIGHT = 35;
const MARGIN_LEVEL_SAFE_LEVEL = 1000;
const MARGIN_LEVEL_CRITICAL_LEVEL = 100;
const MARGIN_LEVEL_SCORE_WEIGHT = 50;
const DEPOSIT_LOAD_SAFE_LEVEL = 40;
const DEPOSIT_LOAD_CRITICAL_LEVEL = 100;
const DEPOSIT_LOAD_SCORE_WEIGHT = 15;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function positiveCapital(input: CriticalScoreInput) {
  const equity = finiteOr(input.equity, 0);
  const balance = finiteOr(input.balance, 0);
  return equity > 0 ? equity : balance > 0 ? balance : 0;
}

export function computeCriticalScore(input: CriticalScoreInput) {
  if (!Number.isFinite(input.openPositionCount) || input.openPositionCount <= 0) {
    return 0;
  }

  const capital = positiveCapital(input);
  const floatingPl = finiteOr(input.floatingPl, 0);
  const floatingLossPct =
    capital > 0 && floatingPl < 0 ? (floatingPl / capital) * -100 : 0;
  const floatingLossPoints =
    (clamp01(floatingLossPct / FLOATING_LOSS_FULL_SCORE_PCT) *
      FLOATING_LOSS_SCORE_WEIGHT);

  const marginLevel = input.marginLevel == null ? null : finiteOr(input.marginLevel, Number.NaN);
  const marginPoints =
    marginLevel == null
      ? 0
      : clamp01(
          (MARGIN_LEVEL_SAFE_LEVEL - marginLevel) /
            (MARGIN_LEVEL_SAFE_LEVEL - MARGIN_LEVEL_CRITICAL_LEVEL),
        ) * MARGIN_LEVEL_SCORE_WEIGHT;

  const depositLoadPct =
    input.depositLoadPct == null ? null : finiteOr(input.depositLoadPct, Number.NaN);
  const depositLoadPoints =
    depositLoadPct == null
      ? 0
      : clamp01(
          (depositLoadPct - DEPOSIT_LOAD_SAFE_LEVEL) /
            (DEPOSIT_LOAD_CRITICAL_LEVEL - DEPOSIT_LOAD_SAFE_LEVEL),
        ) * DEPOSIT_LOAD_SCORE_WEIGHT;

  const score = floatingLossPoints + marginPoints + depositLoadPoints;
  return Math.min(100, Math.max(0, Math.round(score)));
}
