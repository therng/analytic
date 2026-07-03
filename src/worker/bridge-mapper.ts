import { Prisma } from "@prisma/client";

export interface RawDealPayload {
  ticket: number;
  order: number;
  positionId: number | null;
  symbol: string;
  type: string;
  volume: number;
  price: number;
  commission: number;
  fee: number;
  swap: number;
  profit: number;
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
}

function unixToDate(seconds: number): Date {
  return new Date(seconds * 1000);
}

// MT5 position type: 0 = buy, 1 = sell (positions can't be pending, unlike orders).
function positionTypeToString(type: number): string {
  return type === 1 ? "sell" : "buy";
}

export function mapDealPayload(
  tradingAccountId: string,
  raw: RawDealPayload,
): Prisma.BridgeDealUncheckedCreateInput {
  const time = unixToDate(raw.time);
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
  };
}

export function mapDealPayloadToDeal(
  tradingAccountId: string,
  raw: RawDealPayload,
): Prisma.DealUncheckedCreateInput {
  const row = mapDealPayload(tradingAccountId, raw);
  return {
    ...row,
    reportDate: row.time,
  };
}

export function mapOrderPayload(
  tradingAccountId: string,
  raw: RawOrderPayload,
): Prisma.BridgeOrderUncheckedCreateInput {
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
    sl: raw.sl,
    tp: raw.tp,
    timeSetup: unixToDate(raw.timeSetup),
    timeDone: raw.timeDone > 0 ? unixToDate(raw.timeDone) : null,
    comment: raw.comment,
  };
}

export function mapOrderPayloadToOrder(
  tradingAccountId: string,
  raw: RawOrderPayload,
): Prisma.OrderUncheckedCreateInput {
  const row = mapOrderPayload(tradingAccountId, raw);
  return {
    tradingAccountId: row.tradingAccountId,
    orderTicket: row.orderTicket,
    positionId: row.positionId,
    dealId: row.dealId,
    symbol: row.symbol,
    type: row.type,
    state: row.state,
    volume: row.volume,
    priceOpen: row.priceOpen,
    priceCurrent: null,
    sl: row.sl,
    tp: row.tp,
    timeSetup: row.timeSetup,
    timeDone: row.timeDone,
    comment: row.comment,
  };
}

export function mapPositionClosedPayload(
  tradingAccountId: string,
  raw: RawPositionClosedPayload,
): Prisma.BridgePositionUncheckedCreateInput {
  return {
    tradingAccountId,
    positionNo: String(raw.ticket),
    symbol: raw.symbol,
    type: positionTypeToString(raw.positionType),
    volume: raw.volume,
    openTime: unixToDate(raw.entryTime),
    openPrice: raw.entryPrice,
    closeTime: unixToDate(raw.exitTime),
    closePrice: raw.exitPrice,
    commission: raw.commission ?? 0,
    swap: raw.swap ?? 0,
    profit: raw.profit ?? 0,
    comment: raw.comment,
    mae: raw.mae,
    mfe: raw.mfe,
  };
}

export function mapPositionClosedPayloadToPosition(
  tradingAccountId: string,
  raw: RawPositionClosedPayload,
): Prisma.PositionUncheckedCreateInput {
  const row = mapPositionClosedPayload(tradingAccountId, raw);
  return {
    ...row,
    sl: null,
    tp: null,
    reportDate: row.closeTime ?? new Date(),
    pips: null,
  };
}
