import { Prisma } from "@prisma/client";

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
}

export interface RawWorkingOrderPayload {
  ticket: number;
  symbol: string;
  type: string;
  volume: number;
  priceOpen: number;
  priceCurrent: number;
  sl: number;
  tp: number;
  timeSetup: number;
  timeExpiration: number;
  comment: string;
  magic: number;
}

function unixToDate(seconds: number): Date {
  return new Date(seconds * 1000);
}

// MT5 position type: 0 = buy, 1 = sell (positions can't be pending, unlike orders).
function positionTypeToString(type: number): string {
  return type === 1 ? "sell" : "buy";
}

export function mapDealPayloadToDeal(
  tradingAccountId: string,
  raw: RawDealPayload,
): Prisma.DealUncheckedCreateInput {
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
    direction: raw.direction ?? (raw.type === "buy" || raw.type === "sell" ? raw.type : null),
    balance: raw.balanceAfter ?? raw.balance_after ?? null,
    reportDate: time,
  };
}

export function mapOrderPayloadToOrder(
  tradingAccountId: string,
  raw: RawOrderPayload,
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
    timeSetup: unixToDate(raw.timeSetup),
    timeDone: raw.timeDone > 0 ? unixToDate(raw.timeDone) : null,
    comment: raw.comment,
  };
}

export function mapPositionClosedPayloadToPosition(
  tradingAccountId: string,
  raw: RawPositionClosedPayload,
): Prisma.PositionUncheckedCreateInput {
  const closeTime = unixToDate(raw.exitTime);
  return {
    tradingAccountId,
    positionNo: String(raw.ticket),
    symbol: raw.symbol,
    type: positionTypeToString(raw.positionType),
    volume: raw.volume,
    openTime: unixToDate(raw.entryTime),
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
    sl: null,
    tp: null,
    reportDate: closeTime ?? new Date(),
    pips: null,
  };
}

export function mapToWorkingOrder(
  tradingAccountId: string,
  raw: RawWorkingOrderPayload,
): Prisma.WorkingOrderUncheckedCreateInput {
  const timeSetup = unixToDate(raw.timeSetup);
  return {
    tradingAccountId,
    orderNo: String(raw.ticket),
    symbol: raw.symbol,
    type: raw.type,
    volume: raw.volume,
    priceOpen: raw.priceOpen,
    priceCurrent: raw.priceCurrent,
    sl: raw.sl,
    tp: raw.tp,
    timeSetup,
    timeExpiration: raw.timeExpiration > 0 ? unixToDate(raw.timeExpiration) : null,
    comment: raw.comment,
    magic: raw.magic,
    reportDate: new Date(),
  };
}
