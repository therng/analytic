import { computeDepositLoadPercent } from "./drawdown";

/** Product-specific estimated margin required for one filled XAUUSD order lot. */
export const XAUUSD_MARGIN_PER_LOT = 410.3;

export type XauusdMarginSpec = {
  symbol?: "XAUUSD";
  marginPerLotUsd: number;
};

export type XauusdFilledOrderLeg = {
  symbol: string;
  volumeLots: number;
  state?: string | null;
};

export type OpenVolumeLeg = {
  symbol: string;
  volumeLots: number;
  side?: "buy" | "sell";
};

export type DepositLoadByVolumeInput = {
  balance: number;
  orders: XauusdFilledOrderLeg[];
  spec?: XauusdMarginSpec;
};

export type DepositLoadByVolumeResult = {
  xauusdLots: number;
  marginUsedUsd: number;
  balanceUsd: number;
  depositLoadPct: number | null;
};

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isXauusd(symbol: string) {
  return normalizeSymbol(symbol).startsWith("XAUUSD");
}

function isFilledOrder(state: string | null | undefined) {
  return state?.trim().toLowerCase() === "filled";
}

function getXauusdFilledOrderLots(orders: XauusdFilledOrderLeg[]) {
  return orders
    .filter(
      (order) =>
        isXauusd(order.symbol) &&
        isFilledOrder(order.state) &&
        Number.isFinite(order.volumeLots) &&
        order.volumeLots > 0,
    )
    .reduce((sum, order) => sum + order.volumeLots, 0);
}

/** Estimate deposit load from filled XAUUSD order lots without touching persistence. */
export function depositLoadByXauusdFilledOrderVolume({
  balance,
  orders,
  spec,
}: DepositLoadByVolumeInput): DepositLoadByVolumeResult {
  const xauusdLots = getXauusdFilledOrderLots(orders);
  const marginUsedUsd =
    xauusdLots * (spec?.marginPerLotUsd ?? XAUUSD_MARGIN_PER_LOT);

  return {
    xauusdLots,
    marginUsedUsd,
    balanceUsd: balance,
    depositLoadPct:
      xauusdLots > 0
        ? computeDepositLoadPercent({
            equity: balance,
            margin: marginUsedUsd,
          })
        : null,
  };
}

export function marginUsedFromXauusdFilledOrderVolume(
  orders: XauusdFilledOrderLeg[],
  spec?: XauusdMarginSpec,
) {
  return (
    getXauusdFilledOrderLots(orders) *
    (spec?.marginPerLotUsd ?? XAUUSD_MARGIN_PER_LOT)
  );
}

/** Convenience percentage-only form matching the analytics helper convention. */
export function depositLoadFromXauusdFilledOrderVolume(params: {
  balance: number;
  orders: XauusdFilledOrderLeg[];
  spec?: XauusdMarginSpec;
}) {
  return depositLoadByXauusdFilledOrderVolume(params).depositLoadPct;
}

export function depositLoadByXauusdVolume({
  equity,
  openLegs,
  mode,
  spec,
}: {
  equity: number;
  openLegs: OpenVolumeLeg[];
  mode: "gross" | "net";
  spec?: XauusdMarginSpec;
}) {
  const xauusdLegs = openLegs.filter(
    (leg) =>
      isXauusd(leg.symbol) &&
      Number.isFinite(leg.volumeLots) &&
      leg.volumeLots > 0,
  );

  const xauusdLots =
    mode === "net"
      ? Math.abs(
          xauusdLegs.reduce(
            (sum, leg) =>
              sum + (leg.side === "sell" ? -1 : 1) * leg.volumeLots,
            0,
          ),
        )
      : xauusdLegs.reduce((sum, leg) => sum + leg.volumeLots, 0);
  const marginUsedUsd =
    xauusdLots * (spec?.marginPerLotUsd ?? XAUUSD_MARGIN_PER_LOT);

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
  return depositLoadByXauusdVolume({
    equity: 1,
    openLegs: legs,
    mode,
    spec,
  }).marginUsedUsd;
}

export function depositLoadFromXauusdVolume(params: {
  equity: number;
  legs: OpenVolumeLeg[];
  mode?: "gross" | "net";
  spec?: XauusdMarginSpec;
}) {
  return depositLoadByXauusdVolume({
    equity: params.equity,
    openLegs: params.legs,
    mode: params.mode ?? "gross",
    spec: params.spec,
  }).depositLoadPct;
}
