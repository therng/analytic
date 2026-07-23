import type { NumericLike } from "./deal-kernel";
import { normalizeTradeSide } from "./deal-kernel";

function getPricePrecision(value: number | null | undefined) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const normalized = Number(value ?? 0).toString();
  const fractional = normalized.split(".")[1];
  return fractional ? fractional.length : 0;
}

const FX_CODES = new Set([
  "AUD",
  "CAD",
  "CHF",
  "CNH",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "JPY",
  "MXN",
  "NOK",
  "NZD",
  "PLN",
  "SEK",
  "SGD",
  "TRY",
  "USD",
  "ZAR",
]);

export type InstrumentSpec = { pointSize: number; pointsPerPip: number };

const INSTRUMENT_SPECS: Record<string, InstrumentSpec> = {
  // Gold's point (0.01) is the pip itself — no pipette digit like forex has.
  XAUUSD: { pointSize: 0.01, pointsPerPip: 1 },
  BTCUSD: { pointSize: 1, pointsPerPip: 100 },
};

function normalizeSymbol(symbol: string | null | undefined) {
  return (symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function resolveFxPointSize(normalizedSymbol: string) {
  if (normalizedSymbol.length < 6) {
    return null;
  }

  for (let index = 0; index <= normalizedSymbol.length - 6; index += 1) {
    const base = normalizedSymbol.slice(index, index + 3);
    const quote = normalizedSymbol.slice(index + 3, index + 6);
    if (FX_CODES.has(base) && FX_CODES.has(quote)) {
      return quote === "JPY" ? 0.001 : 0.00001;
    }
  }

  return null;
}

export function resolveInstrumentSpec(
  symbol: string | null | undefined,
  openPrice: number | null | undefined,
  closePrice: number | null | undefined,
): InstrumentSpec {
  const normalized = normalizeSymbol(symbol);

  const explicit = INSTRUMENT_SPECS[normalized];
  if (explicit) {
    return explicit;
  }

  const fxPointSize = resolveFxPointSize(normalized);
  if (fxPointSize !== null) {
    return { pointSize: fxPointSize, pointsPerPip: 10 };
  }

  const precision = Math.max(
    getPricePrecision(openPrice),
    getPricePrecision(closePrice),
  );
  const pointSize = precision > 0 ? 10 ** -precision : 1;
  return { pointSize, pointsPerPip: 10 };
}

export function positionPips(position: {
  symbol?: string | null;
  type?: string | null;
  direction?: string | null;
  openPrice?: NumericLike;
  closePrice?: NumericLike;
}) {
  const openPrice = Number(position.openPrice ?? Number.NaN);
  const closePrice = Number(position.closePrice ?? Number.NaN);
  if (!Number.isFinite(openPrice) || !Number.isFinite(closePrice)) {
    return null;
  }

  const side = normalizeTradeSide(
    position.type,
    position.direction ?? position.type,
  );
  if (side !== "buy" && side !== "sell") {
    return null;
  }

  const spec = resolveInstrumentSpec(position.symbol, openPrice, closePrice);
  if (!Number.isFinite(spec.pointSize) || spec.pointSize <= 0) {
    return null;
  }

  const rawPoints =
    side === "buy"
      ? (closePrice - openPrice) / spec.pointSize
      : (openPrice - closePrice) / spec.pointSize;
  const rawPips = rawPoints / spec.pointsPerPip;
  return Number.isFinite(rawPips) ? rawPips : null;
}
