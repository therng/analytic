"use client";

import type { SerializedAccount, Timeframe } from "@/lib/trading/types";

const EMPTY_TEXT_VALUES = new Set(["unknown", "n/a", "na", "--"]);

export const TIMEFRAME_OPTIONS: Array<{
  value: Timeframe;
  label: string;
  ariaLabel: string;
}> = [
  { value: "1d", label: "1 วัน", ariaLabel: "1 วัน" },
  { value: "1w", label: "1 สัปดาห์", ariaLabel: "1 สัปดาห์" },
  { value: "1m", label: "1 เดือน", ariaLabel: "1 เดือน" },
  { value: "3m", label: "3 เดือน", ariaLabel: "3 เดือน" },
  { value: "6m", label: "6 เดือน", ariaLabel: "6 เดือน" },
  { value: "1y", label: "1 ปี", ariaLabel: "1 ปี" },
  { value: "all", label: "ทั้งหมด", ariaLabel: "ทั้งหมด" },
];

export type MetricTone =
  "positive" | "negative" | "warning" | "neutral" | "muted" | "info";

const DEFAULT_CURRENCY_SYMBOL = "$";
const COMPACT_SUFFIXES = [
  { value: 1_000_000_000, suffix: "B" },
  { value: 1_000_000, suffix: "M" },
  { value: 1_000, suffix: "K" },
] as const;

export function getSignedPrefix(value: number) {
  if (value > 0) {
    return "+";
  }

  if (value < 0) {
    return "-";
  }

  return "";
}

function stripTrailingZero(value: string) {
  return value.includes(".")
    ? value.replace(/\.0+(?=[A-Za-z%]|$)|(\.\d*?[1-9])0+(?=[A-Za-z%]|$)/g, "$1")
    : value;
}

function roundHalfUp(value: number, digits = 0) {
  if (!Number.isFinite(value)) {
    return value;
  }

  const normalizedDigits = Math.max(0, digits);
  const absolute = Math.abs(value);
  const rounded = Number(
    `${Math.round(Number(`${absolute}e${normalizedDigits}`))}e-${normalizedDigits}`,
  );
  return Math.sign(value) * rounded;
}

function formatRoundedNumber(
  value: number,
  digits: number,
  fixedDigits = false,
) {
  const rounded = roundHalfUp(value, digits);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fixedDigits ? digits : 0,
    maximumFractionDigits: digits,
  }).format(rounded);

  return fixedDigits ? formatted : stripTrailingZero(formatted);
}

function formatCompactAbsolute(value: number, digits = 1) {
  let suffixIndex = COMPACT_SUFFIXES.findIndex((entry) => value >= entry.value);

  if (suffixIndex === -1) {
    const rounded = roundHalfUp(value, digits);
    if (rounded >= 1000) {
      const threshold = COMPACT_SUFFIXES[COMPACT_SUFFIXES.length - 1]!;
      return `${formatRoundedNumber(roundHalfUp(value / threshold.value, digits), digits)}${threshold.suffix}`;
    }

    return formatRoundedNumber(value, digits);
  }

  while (suffixIndex > 0) {
    const current = COMPACT_SUFFIXES[suffixIndex]!;
    const scaled = roundHalfUp(value / current.value, digits);
    if (scaled < 1000) {
      return `${formatRoundedNumber(scaled, digits)}${current.suffix}`;
    }

    suffixIndex -= 1;
  }

  const fallback = COMPACT_SUFFIXES[0]!;
  return `${formatRoundedNumber(roundHalfUp(value / fallback.value, digits), digits)}${fallback.suffix}`;
}

export function formatCurrency(
  value: number | null | undefined,
  digits = 2,
  currencySymbol = DEFAULT_CURRENCY_SYMBOL,
) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  const numeric = value ?? 0;
  const sign = numeric < 0 ? "-" : "";
  return `${sign}${currencySymbol}${formatRoundedNumber(Math.abs(numeric), digits, true)}`;
}

export function formatSignedCurrency(
  value: number | null | undefined,
  digits = 2,
  currencySymbol = DEFAULT_CURRENCY_SYMBOL,
) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  const numeric = value ?? 0;
  return `${getSignedPrefix(numeric)}${formatCurrency(Math.abs(numeric), digits, currencySymbol)}`;
}

export function formatPercent(value: number | null | undefined, digits = 1) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  const numeric = value ?? 0;
  return `${getSignedPrefix(numeric)}${formatRoundedNumber(Math.abs(numeric), digits)}%`;
}

export function formatWholeNumber(value: number | null | undefined) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

export function formatCompactNumber(
  value: number | null | undefined,
  digits = 1,
) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  const numeric = value ?? 0;
  const sign = numeric < 0 ? "-" : "";
  return `${sign}${formatCompactAbsolute(Math.abs(numeric), digits)}`;
}

export function formatCompactCount(
  value: number | null | undefined,
  digits = 1,
) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return formatCompactAbsolute(Math.abs(value ?? 0), digits);
}

export function formatCompactSignedNumber(
  value: number | null | undefined,
  digits = 1,
) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  const numeric = value ?? 0;
  return `${getSignedPrefix(numeric)}${formatCompactNumber(Math.abs(numeric), digits)}`;
}

export function displayName(account: SerializedAccount) {
  const owner = sanitizeOptionalText(account.owner_name);
  return owner ?? sanitizeOptionalText(account.server) ?? "Account";
}

export function toneFromNumber(value: number | null | undefined): MetricTone {
  if (!Number.isFinite(value)) {
    return "muted";
  }

  if ((value ?? 0) > 0) {
    return "positive";
  }

  if ((value ?? 0) < 0) {
    return "negative";
  }

  return "neutral";
}

export function drawdownTone(value: number | null | undefined): MetricTone {
  if (!Number.isFinite(value)) {
    return "muted";
  }

  if ((value ?? 0) <= 5) {
    return "neutral";
  }

  if ((value ?? 0) <= 15) {
    return "warning";
  }

  return "negative";
}

export function depositLoadTone(value: number | null | undefined): MetricTone {
  if (!Number.isFinite(value)) return "muted";
  if ((value ?? 0) <= 20) return "positive";
  if ((value ?? 0) <= 50) return "warning";
  return "negative";
}

export function absDrawdownTone(value: number | null | undefined): MetricTone {
  if (!Number.isFinite(value)) {
    return "muted";
  }

  return (value ?? 0) < 0 ? "negative" : "neutral";
}

function sanitizeOptionalText(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  return EMPTY_TEXT_VALUES.has(normalized.toLowerCase()) ? null : normalized;
}
