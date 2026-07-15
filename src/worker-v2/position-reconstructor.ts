// Reconstructs closed positions (Position + ClosedPosition) purely from
// persisted Deal rows for one (tradingAccountId, positionId) group. No Python
// bridge involvement, no polling loop — triggered by deal-consumer.ts after
// every deal that can change position state (in/out/inout/out_by).
//
// Algorithm: walk deals chronologically, track unsigned open volume + open
// side. "in" adds to the open side (establishing it if flat). "out"/"out_by"
// reduce it. "inout" (MT5 reversal) splits its volume at the pre-deal open
// volume: the min(...) portion closes the existing side at this deal's
// price, the remainder (if any) opens the opposite side at the same price —
// this is exact because a reversal always fills at one price. A position is
// "closed" only when open volume returns to exactly zero. If volume returns
// to zero and then a later deal makes it nonzero again (position reopened
// under the same MT5 position_id), the schema's one-row-per-position_id
// shape can't represent two distinct closed lifecycles — that case is
// reported, not silently resolved into one wrong row.
import type { Prisma, PrismaClient } from "@prisma/client";
import { toDecimalOrZero } from "./decimal";

export interface DealForReconstruction {
  dealNo: string;
  time: Date;
  symbol: string | null;
  type: string;
  direction: string | null;
  volume: number | null;
  price: Prisma.Decimal | null;
  commission: Prisma.Decimal;
  swap: Prisma.Decimal;
  profit: Prisma.Decimal;
  fee: Prisma.Decimal;
  comment: string | null;
}

export interface ClosedPositionFields {
  symbol: string;
  side: "buy" | "sell";
  totalOpenedVolume: number;
  openPrice: Prisma.Decimal;
  closePrice: Prisma.Decimal;
  openTime: Date;
  closeTime: Date;
  durationSeconds: number;
  grossProfit: Prisma.Decimal;
  commission: Prisma.Decimal;
  swap: Prisma.Decimal;
  fee: Prisma.Decimal;
  netPnl: Prisma.Decimal;
  comment: string | null;
}

export type PositionLifecycleResult =
  | { status: "no-deals" }
  | { status: "open" }
  | { status: "closed"; fields: ClosedPositionFields }
  | { status: "ambiguous-reopen"; lastDealNo: string };

function dealSortKey(d: DealForReconstruction): [number, bigint] {
  let ticket: bigint;
  try {
    ticket = BigInt(d.dealNo);
  } catch {
    ticket = 0n;
  }
  return [d.time.getTime(), ticket];
}

function sortDeals(deals: DealForReconstruction[]): DealForReconstruction[] {
  return [...deals].sort((a, b) => {
    const [at, an] = dealSortKey(a);
    const [bt, bn] = dealSortKey(b);
    if (at !== bt) return at - bt;
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
}

const isDecimalZero = (v: Prisma.Decimal) => v.isZero();

export function computePositionLifecycle(rawDeals: DealForReconstruction[]): PositionLifecycleResult {
  if (rawDeals.length === 0) return { status: "no-deals" };
  const deals = sortDeals(rawDeals);

  let openVolume = toDecimalOrZero(0);
  let openSide: "buy" | "sell" | null = null;
  let openTime: Date | null = null;
  let closeTime: Date | null = null;
  let entryWeightedSum = toDecimalOrZero(0);
  let entryVolumeSum = toDecimalOrZero(0);
  let exitWeightedSum = toDecimalOrZero(0);
  let exitVolumeSum = toDecimalOrZero(0);
  let grossProfit = toDecimalOrZero(0);
  let commission = toDecimalOrZero(0);
  let swap = toDecimalOrZero(0);
  let fee = toDecimalOrZero(0);
  let symbol: string | null = null;
  let lastComment: string | null = null;
  let totalOpenedVolume = toDecimalOrZero(0);
  let closedOnceAlready = false;

  for (const d of deals) {
    grossProfit = grossProfit.plus(d.profit);
    commission = commission.plus(d.commission);
    swap = swap.plus(d.swap);
    fee = fee.plus(d.fee);
    if (d.symbol) symbol = d.symbol;

    const vol = toDecimalOrZero(d.volume ?? 0);
    if (isDecimalZero(vol)) continue; // zero-volume commission/swap/fee-only rows: P/L only, no state change

    const side: "buy" | "sell" | null = d.type === "buy" ? "buy" : d.type === "sell" ? "sell" : null;
    if (side === null) continue; // non-trade deal type carrying volume is unexpected; ignore for state

    if (!openTime) openTime = d.time;

    if (openVolume.isZero() && closedOnceAlready) {
      // Position already fully closed once, and a further volume-changing
      // deal arrived for the same position_id — MT5 reused the ticket for a
      // new lifecycle. One row per position_id cannot represent both.
      return { status: "ambiguous-reopen", lastDealNo: d.dealNo };
    }

    if (openVolume.isZero()) {
      // Flat -> establishes (or re-establishes, see guard above) the side.
      openSide = side;
      openVolume = vol;
      entryWeightedSum = d.price ? entryWeightedSum.plus(d.price.times(vol)) : entryWeightedSum;
      entryVolumeSum = d.price ? entryVolumeSum.plus(vol) : entryVolumeSum;
      totalOpenedVolume = totalOpenedVolume.plus(vol);
      lastComment = d.comment;
      continue;
    }

    if (side === openSide) {
      // Adding to the existing side (direction "in", or occasionally "inout"
      // with no prior exposure — handled by the isZero() branch above).
      openVolume = openVolume.plus(vol);
      entryWeightedSum = d.price ? entryWeightedSum.plus(d.price.times(vol)) : entryWeightedSum;
      entryVolumeSum = d.price ? entryVolumeSum.plus(vol) : entryVolumeSum;
      totalOpenedVolume = totalOpenedVolume.plus(vol);
      lastComment = d.comment;
      continue;
    }

    // Opposite side: closes existing exposure, and — if this single deal's
    // volume exceeds what was open (a genuine MT5 "inout" reversal) — opens
    // the remainder on the new side at the same fill price.
    const closingPortion = vol.lessThan(openVolume) ? vol : openVolume;
    exitWeightedSum = d.price ? exitWeightedSum.plus(d.price.times(closingPortion)) : exitWeightedSum;
    exitVolumeSum = d.price ? exitVolumeSum.plus(closingPortion) : exitVolumeSum;
    openVolume = openVolume.minus(closingPortion);
    closeTime = d.time;
    lastComment = d.comment;

    if (openVolume.isZero()) {
      closedOnceAlready = true;
    }

    const remainder = vol.minus(closingPortion);
    if (remainder.greaterThan(0)) {
      openSide = side;
      openVolume = remainder;
      closedOnceAlready = false;
      entryWeightedSum = d.price ? entryWeightedSum.plus(d.price.times(remainder)) : entryWeightedSum;
      entryVolumeSum = d.price ? entryVolumeSum.plus(remainder) : entryVolumeSum;
      totalOpenedVolume = totalOpenedVolume.plus(remainder);
    }
  }

  if (!openVolume.isZero()) return { status: "open" };
  if (!openTime || !closeTime || !openSide || !symbol) return { status: "open" };
  if (entryVolumeSum.isZero() || exitVolumeSum.isZero()) return { status: "open" };

  const openPrice = entryWeightedSum.dividedBy(entryVolumeSum);
  const closePrice = exitWeightedSum.dividedBy(exitVolumeSum);
  const netPnl = grossProfit.plus(swap).plus(commission).plus(fee);

  return {
    status: "closed",
    fields: {
      symbol,
      side: openSide,
      totalOpenedVolume: totalOpenedVolume.toNumber(),
      openPrice,
      closePrice,
      openTime,
      closeTime,
      durationSeconds: Math.max(0, Math.round((closeTime.getTime() - openTime.getTime()) / 1000)),
      grossProfit,
      commission,
      swap,
      fee,
      netPnl,
      comment: lastComment,
    },
  };
}

export async function reconstructPositionIfClosed(
  prisma: PrismaClient,
  tradingAccountId: string,
  accountNo: string,
  positionId: string,
): Promise<PositionLifecycleResult> {
  const deals = await prisma.deal.findMany({
    where: { tradingAccountId, positionId },
    select: {
      dealNo: true, time: true, symbol: true, type: true, direction: true,
      volume: true, price: true, commission: true, swap: true, profit: true, fee: true, comment: true,
    },
  });

  const result = computePositionLifecycle(deals as DealForReconstruction[]);
  if (result.status !== "closed") return result;

  const f = result.fields;

  await prisma.$transaction([
    prisma.position.upsert({
      where: { tradingAccountId_positionNo: { tradingAccountId, positionNo: positionId } },
      create: {
        tradingAccountId,
        positionNo: positionId,
        symbol: f.symbol,
        type: f.side,
        volume: f.totalOpenedVolume,
        openTime: f.openTime,
        openPrice: f.openPrice,
        closeTime: f.closeTime,
        closePrice: f.closePrice,
        commission: f.commission,
        swap: f.swap,
        profit: f.grossProfit,
        comment: f.comment,
        reportDate: f.closeTime,
      },
      update: {
        symbol: f.symbol,
        type: f.side,
        volume: f.totalOpenedVolume,
        openTime: f.openTime,
        openPrice: f.openPrice,
        closeTime: f.closeTime,
        closePrice: f.closePrice,
        commission: f.commission,
        swap: f.swap,
        profit: f.grossProfit,
        comment: f.comment,
        reportDate: f.closeTime,
      },
    }),
    prisma.closedPosition.upsert({
      where: { account_number_position_id: { account_number: accountNo, position_id: positionId } },
      create: {
        account_number: accountNo,
        position_id: positionId,
        symbol: f.symbol,
        type: f.side,
        volume: f.totalOpenedVolume,
        open_time: f.openTime,
        open_price: f.openPrice,
        close_time: f.closeTime,
        close_price: f.closePrice,
        commission: f.commission,
        swap: f.swap,
        profit: f.grossProfit,
        net_pnl: f.netPnl,
        comment: f.comment,
      },
      update: {
        symbol: f.symbol,
        type: f.side,
        volume: f.totalOpenedVolume,
        open_time: f.openTime,
        open_price: f.openPrice,
        close_time: f.closeTime,
        close_price: f.closePrice,
        commission: f.commission,
        swap: f.swap,
        profit: f.grossProfit,
        net_pnl: f.netPnl,
        comment: f.comment,
      },
    }),
  ]);

  return result;
}
