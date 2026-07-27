import { computeDepositLoadPercent } from "./drawdown";

/** Broker-specific estimated margin required for one XAUUSD lot. */
export const XAUUSD_MARGIN_PER_LOT = 410.3;

export type XauusdMarginSpec = {
  symbol: "XAUUSD";
  marginPerLotUsd: number;
};

export type OpenVolumeLeg = {
  symbol: string;
  volumeLots: number;
  side?: "buy" | "sell";
};

export type DepositLoadByVolumeInput = {
  equity: number;
  openLegs: OpenVolumeLeg[];
  mode: "gross" | "net";
  spec?: XauusdMarginSpec;
};

export type DepositLoadByVolumeResult = {
  xauusdLots: number;
  marginUsedUsd: number;
  equityUsd: number;
  depositLoadPct: number | null;
};

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isXauusd(symbol: string) {
  return normalizeSymbol(symbol).startsWith("XAUUSD");
}

function getXauusdLots(legs: OpenVolumeLeg[], mode: "gross" | "net") {
  const xauusdLegs = legs.filter(
    (leg) => isXauusd(leg.symbol) && Number.isFinite(leg.volumeLots) && leg.volumeLots > 0,
  );

  if (mode === "net") {
    return Math.abs(
      xauusdLegs.reduce(
        (sum, leg) => sum + (leg.side === "sell" ? -1 : 1) * leg.volumeLots,
        0,
      ),
    );
  }

  return xauusdLegs.reduce((sum, leg) => sum + leg.volumeLots, 0);
}

/** Estimate XAUUSD margin from currently open lots without touching persistence. */
export function depositLoadByXauusdVolume({
  equity,
  openLegs,
  mode,
  spec,
}: DepositLoadByVolumeInput): DepositLoadByVolumeResult {
  const xauusdLots = getXauusdLots(openLegs, mode);
  const marginUsedUsd = xauusdLots * (spec?.marginPerLotUsd ?? XAUUSD_MARGIN_PER_LOT);

  return {
    xauusdLots,
    marginUsedUsd,
    equityUsd: equity,
    depositLoadPct: computeDepositLoadPercent({
      equity,
      margin: marginUsedUsd,
    }),
  };
}

export function marginUsedFromXauusdVolume(
  legs: OpenVolumeLeg[],
  mode: "gross" | "net" = "gross",
  spec?: XauusdMarginSpec,
) {
  return getXauusdLots(legs, mode) * (spec?.marginPerLotUsd ?? XAUUSD_MARGIN_PER_LOT);
}

/** Convenience percentage-only form matching the analytics helper convention. */
export function depositLoadFromXauusdVolume(params: {
  equity: number;
  legs: OpenVolumeLeg[];
  mode?: "gross" | "net";
  spec?: XauusdMarginSpec;
}) {
  return computeDepositLoadPercent({
    equity: params.equity,
    margin: marginUsedFromXauusdVolume(
      params.legs,
      params.mode ?? "gross",
      params.spec,
    ),
  });
}
