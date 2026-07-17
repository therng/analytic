import { getSignedPrefix } from "@/components/trading-monitor/formatters";

export type ExpandableKpiKey =
  "gain" | "dd" | "pips" | "profit" | "trades" | "opens";

export function getSideToneClass(sideLabel: string) {
  const normalizedSide = sideLabel.toLowerCase();
  if (normalizedSide === "buy") return "trade-history-row__side--buy";
  if (normalizedSide === "sell") return "trade-history-row__side--sell";
  return "";
}

export function getPnlToneClass(pnl: number) {
  if (pnl > 0) return "trade-history-row__trail--positive";
  if (pnl < 0) return "trade-history-row__trail--negative";
  return "trade-history-row__trail--neutral";
}

function trimTrailingZeroDecimals(value: string) {
  return value
    .replace(/(\.\d*?[1-9])0+(?=[a-z%]|$)/gi, "$1")
    .replace(/\.0+(?=[a-z%]|$)/gi, "");
}

export function formatPlainPercent(
  value: number | null | undefined,
  digits = 1,
) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return `${trimTrailingZeroDecimals(Math.abs(value ?? 0).toFixed(digits))}%`;
}

function formatPlainAmount(value: number, digits = 1) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPlainNumberValue(
  value: number | null | undefined,
  digits = 2,
) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return trimTrailingZeroDecimals(Number(value ?? 0).toFixed(digits));
}

export function formatSignedPlainNumberValue(
  value: number | null | undefined,
  digits = 1,
) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  const numeric = value ?? 0;
  return `${getSignedPrefix(numeric)}${trimTrailingZeroDecimals(Math.abs(numeric).toFixed(digits))}`;
}

export function formatSignedPlainAmountKpiValue(
  value: number | null | undefined,
  digits = 1,
) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  const numeric = value ?? 0;
  return `${getSignedPrefix(numeric)}${formatPlainAmount(Math.abs(numeric), digits)}`;
}

export function formatPositionSide(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized.includes("buy")) {
    return "Buy";
  }

  if (normalized.includes("sell")) {
    return "Sell";
  }

  if (!normalized) {
    return "-";
  }

  return normalized.slice(0, 1).toUpperCase() + normalized.slice(1);
}

export function formatTradePrice(value: number | null | undefined) {
  if (!Number.isFinite(value)) {
    return "Mkt";
  }

  return formatPlainNumberValue(value, 5);
}

export function formatMagicNumber(value: number | null | undefined) {
  if (!Number.isFinite(value) || !value) {
    return "-";
  }

  return String(value);
}

// e.g. comment "ABC Bot", magic 1234 -> "ABC Bot(1234)"
export function formatTradeComment(
  comment: string | null | undefined,
  magic: number | null | undefined,
) {
  const trimmed = comment?.trim() || "";
  const hasMagic = Number.isFinite(magic) && !!magic;

  if (!trimmed && !hasMagic) return "-";
  if (!hasMagic) return trimmed;
  return trimmed ? `${trimmed}(${magic})` : `(${magic})`;
}

export function formatTradeExitReason(position: {
  exitReason?: string | null;
  slHit?: boolean | null;
  tpHit?: boolean | null;
}) {
  if (position.slHit || position.exitReason?.toUpperCase() === "SL") {
    return "SL hit";
  }

  if (position.tpHit || position.exitReason?.toUpperCase() === "TP") {
    return "TP hit";
  }

  return "Manual";
}

export function getTradeExitToneClass(position: {
  slHit?: boolean | null;
  tpHit?: boolean | null;
}) {
  if (position.slHit) {
    return "trade-history-row__val--sl-hit";
  }

  if (position.tpHit) {
    return "trade-history-row__val--tp-hit";
  }

  return "trade-history-row__val--white";
}

export function positionHistoryNetPnl(position: {
  profit?: number | null;
  swap?: number | null;
  commission?: number | null;
}) {
  return (
    Number(position.profit ?? 0) +
    Number(position.swap ?? 0) +
    Number(position.commission ?? 0)
  );
}
