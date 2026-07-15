import type { Prisma } from "@prisma/client";
import { serverTimeToUtc } from "../../lib/time";
import { toDecimal, toDecimalOrZero } from "../decimal";
import {
  decodeDealType,
  decodeDealEntry,
  decodeOrderType,
  decodePositionSide,
} from "../mt5-enums";

export function mapDealToPrisma(
  tradingAccountId: string,
  record: Record<string, unknown>,
  offsetMinutes: number,
): Prisma.DealUncheckedCreateInput {
  const time = serverTimeToUtc(Number(record.time), offsetMinutes);
  return {
    tradingAccountId,
    dealNo: String(record.ticket),
    time,
    symbol: record.symbol != null ? String(record.symbol) : null,
    type: decodeDealType(record.type),
    direction: decodeDealEntry(record.entry),
    volume: record.volume != null ? Number(record.volume) : null,
    price: toDecimal(record.price),
    commission: toDecimalOrZero(record.commission),
    fee: toDecimalOrZero(record.fee),
    swap: toDecimalOrZero(record.swap),
    profit: toDecimalOrZero(record.profit),
    comment: record.comment != null ? String(record.comment) : null,
    reportDate: time,
    orderId: record.order != null ? String(record.order) : null,
    positionId: record.position_id != null ? String(record.position_id) : null,
  };
}

export function computeDealNetProfit(
  record: Record<string, unknown>,
): Prisma.Decimal {
  return toDecimalOrZero(record.profit)
    .plus(toDecimalOrZero(record.swap))
    .plus(toDecimalOrZero(record.commission))
    .plus(toDecimalOrZero(record.fee));
}

export function mapOrderToPrisma(
  tradingAccountId: string,
  record: Record<string, unknown>,
  offsetMinutes: number,
): Prisma.OrderUncheckedCreateInput {
  const volumeSource = record.volume_current ?? record.volume_initial;
  return {
    tradingAccountId,
    orderTicket: String(record.ticket),
    positionId: record.position_id != null ? String(record.position_id) : null,
    symbol: record.symbol != null ? String(record.symbol) : null,
    type: record.type != null ? decodeOrderType(record.type) : null,
    state: record.state != null ? String(record.state) : null,
    volume: volumeSource != null ? Number(volumeSource) : null,
    priceOpen: toDecimal(record.price_open),
    priceCurrent: toDecimal(record.price_current),
    sl: toDecimal(record.sl),
    tp: toDecimal(record.tp),
    timeSetup:
      record.time_setup != null
        ? serverTimeToUtc(Number(record.time_setup), offsetMinutes)
        : null,
    timeDone:
      record.time_done != null
        ? serverTimeToUtc(Number(record.time_done), offsetMinutes)
        : null,
    comment: record.comment != null ? String(record.comment) : null,
  };
}

export function mapLiveToAccountSnapshot(
  tradingAccountId: string,
  hash: Record<string, string>,
  heartbeatLastSeenEpoch: number,
): Prisma.AccountSnapshotUncheckedCreateInput {
  return {
    tradingAccountId,
    balance: toDecimalOrZero(hash.balance),
    equity: toDecimalOrZero(hash.equity),
    margin: toDecimalOrZero(hash.margin),
    freeMargin: toDecimalOrZero(hash.margin_free),
    marginLevel: hash.margin_level ? Number(hash.margin_level) : null,
    floatingPl: toDecimalOrZero(hash.profit),
    creditFacility: toDecimalOrZero(hash.credit),
    reportDate: new Date(heartbeatLastSeenEpoch * 1000),
  };
}

export function mapPositionToOpenPosition(
  tradingAccountId: string,
  position: Record<string, unknown>,
  offsetMinutes: number,
  reportDate: Date,
): Prisma.OpenPositionUncheckedCreateInput {
  return {
    tradingAccountId,
    positionNo: String(position.ticket),
    openTime:
      position.time != null
        ? serverTimeToUtc(Number(position.time), offsetMinutes)
        : null,
    symbol: String(position.symbol ?? ""),
    type: decodePositionSide(position.type) ?? "",
    volume: position.volume != null ? Number(position.volume) : 0,
    price: toDecimalOrZero(position.price_open),
    sl: toDecimal(position.sl),
    tp: toDecimal(position.tp),
    marketPrice: toDecimalOrZero(position.price_current),
    swap: toDecimalOrZero(position.swap),
    profit: toDecimalOrZero(position.profit),
    comment: position.comment != null ? String(position.comment) : null,
    magic: position.magic != null ? Number(position.magic) : null,
    reportDate,
  };
}
