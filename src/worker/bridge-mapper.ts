import { Prisma } from "@prisma/client";
import { serverTimeToUtc } from "../lib/time";

export interface RawDealPayload {
  ticket: number;
  order: number;
  positionId: number | null;
  symbol: string;
  type: string;
  direction?: string | null;
  volume: number;
  price: number;
  commission: number;
  fee: number;
  swap: number;
  profit: number;
  balanceAfter?: number | null;
  balance_after?: number | null;
  time: number;
  comment: string;
}

export interface RawOrderPayload {
  ticket: number;
  positionId: number | null;
  symbol: string;
  type: string;
  state: string;
  volume: number;
  priceOpen: number;
  sl: number;
  tp: number;
  timeSetup: number;
  timeDone: number;
  comment: string;
}

export interface RawPositionClosedPayload {
  ticket: number;
  symbol: string;
  positionType: number;
  volume: number;
  entryPrice: number;
  exitPrice: number | null;
  entryTime: number;
  exitTime: number;
  durationSeconds: number;
  mae: number;
  mfe: number;
  profit: number | null;
  commission: number | null;
  swap: number | null;
  dealTicket: number | null;
  orderTicket: number | null;
  comment: string;
  magic?: number | null;
  sl?: number | null;
  tp?: number | null;
}

// MT5 position type: 0 = buy, 1 = sell (positions can't be pending, unlike orders).
function positionTypeToString(type: number): string {
  return type === 1 ? "sell" : "buy";
}

export function mapDealPayloadToDeal(
  tradingAccountId: string,
  raw: RawDealPayload,
  brokerUtcOffsetMinutes: number,
): Prisma.DealUncheckedCreateInput {
  const time = serverTimeToUtc(raw.time, brokerUtcOffsetMinutes);
  return {
    tradingAccountId,
    dealNo: String(raw.ticket),
    positionId: raw.positionId != null ? String(raw.positionId) : null,
    orderId: raw.order != null ? String(raw.order) : null,
    time,
    symbol: raw.symbol,
    type: raw.type,
    volume: raw.volume,
    price: raw.price,
    commission: raw.commission,
    fee: raw.fee,
    swap: raw.swap,
    profit: raw.profit,
    comment: raw.comment,
    direction: raw.direction ?? (raw.type === "buy" || raw.type === "sell" ? raw.type : null),
    balance: raw.balanceAfter ?? raw.balance_after ?? null,
    reportDate: time,
  };
}

export function mapOrderPayloadToOrder(
  tradingAccountId: string,
  raw: RawOrderPayload,
  brokerUtcOffsetMinutes: number,
): Prisma.OrderUncheckedCreateInput {
  return {
    tradingAccountId,
    orderTicket: String(raw.ticket),
    positionId: raw.positionId != null ? String(raw.positionId) : null,
    dealId: null,
    symbol: raw.symbol,
    type: raw.type,
    state: raw.state,
    volume: raw.volume,
    priceOpen: raw.priceOpen,
    priceCurrent: null,
    sl: raw.sl,
    tp: raw.tp,
    timeSetup: serverTimeToUtc(raw.timeSetup, brokerUtcOffsetMinutes),
    timeDone: raw.timeDone > 0 ? serverTimeToUtc(raw.timeDone, brokerUtcOffsetMinutes) : null,
    comment: raw.comment,
  };
}

export function mapPositionClosedPayloadToPosition(
  tradingAccountId: string,
  raw: RawPositionClosedPayload,
  brokerUtcOffsetMinutes: number,
): Prisma.PositionUncheckedCreateInput {
  const closeTime = serverTimeToUtc(raw.exitTime, brokerUtcOffsetMinutes);
  return {
    tradingAccountId,
    positionNo: String(raw.ticket),
    symbol: raw.symbol,
    type: positionTypeToString(raw.positionType),
    volume: raw.volume,
    openTime: serverTimeToUtc(raw.entryTime, brokerUtcOffsetMinutes),
    openPrice: raw.entryPrice,
    closeTime,
    closePrice: raw.exitPrice,
    commission: raw.commission ?? 0,
    swap: raw.swap ?? 0,
    profit: raw.profit ?? 0,
    comment: raw.comment,
    magic: raw.magic ?? null,
    mae: raw.mae,
    mfe: raw.mfe,
    sl: raw.sl ?? null,
    tp: raw.tp ?? null,
    reportDate: closeTime ?? new Date(),
    pips: null,
  };
}
