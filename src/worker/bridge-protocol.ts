import { createHash } from "node:crypto";

export type HistoryStream = "deals" | "orders" | "position-closed";
export type RawCursor = { time: string; ticket: string };

export interface RecordEnvelope {
  version: 1;
  type: "record";
  accountNo: string;
  stream: HistoryStream;
  chunkId: string;
  parentChunkId: string | null;
  windowStartServerTime: string;
  windowEndServerTime: string;
  dealCursor: RawCursor;
  orderCursor: RawCursor;
  ordinal: number;
  expectedCount: number;
  reachedPresent: boolean;
  eventKey: string;
  payload: Record<string, unknown>;
  payloadJson: string;
  payloadSha256: string;
}

export interface HistoryBarrier {
  version: 1;
  type: "barrier";
  accountNo: string;
  stream: HistoryStream;
  chunkId: string;
  parentChunkId: string | null;
  windowStartServerTime: string;
  windowEndServerTime: string;
  dealCursor: RawCursor;
  orderCursor: RawCursor;
  recordCount: number;
  recordsSha256: string;
  reachedPresent: boolean;
  reconstructionState: Record<string, unknown> | null;
  redisEntryId?: string;
}

const SHA256 = /^[a-f0-9]{64}$/;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stablePayloadJson(payload: Record<string, unknown>) {
  return JSON.stringify(payload);
}

function assertStream(value: unknown): asserts value is HistoryStream {
  if (value !== "deals" && value !== "orders" && value !== "position-closed") {
    throw new Error(`invalid history stream: ${String(value)}`);
  }
}

function assertRawCursor(
  value: unknown,
  label: string,
): asserts value is RawCursor {
  if (
    !value ||
    typeof value !== "object" ||
    !/^\d+(?:\.\d+)?$/.test(String((value as RawCursor).time)) ||
    !/^\d+$/.test(String((value as RawCursor).ticket))
  ) {
    throw new Error(`invalid ${label} cursor`);
  }
}

export function buildRecordEnvelope(input: {
  accountNo: string;
  stream: HistoryStream;
  chunkId: string;
  parentChunkId: string | null;
  windowStartServerTime: string;
  windowEndServerTime: string;
  dealCursor: RawCursor;
  orderCursor: RawCursor;
  ordinal: number;
  expectedCount: number;
  reachedPresent?: boolean;
  eventKey: string;
  payload: Record<string, unknown>;
}): RecordEnvelope {
  const payloadJson = stablePayloadJson(input.payload);
  return {
    version: 1,
    type: "record",
    ...input,
    payloadJson,
    payloadSha256: sha256(payloadJson),
    reachedPresent: input.reachedPresent ?? false,
  };
}

export function parseRecordEnvelope(raw: string): RecordEnvelope {
  const value = JSON.parse(raw) as Partial<RecordEnvelope>;
  if (value.version !== 1 || value.type !== "record")
    throw new Error("invalid history record envelope");
  assertStream(value.stream);
  if (
    !value.accountNo ||
    !value.chunkId ||
    !value.eventKey ||
    value.parentChunkId === undefined
  )
    throw new Error("incomplete history record envelope");
  assertRawCursor(value.dealCursor, "deal");
  assertRawCursor(value.orderCursor, "order");
  if (typeof value.reachedPresent !== "boolean")
    throw new Error("invalid history record tail flag");
  const ordinal = value.ordinal;
  const expectedCount = value.expectedCount;
  if (
    typeof ordinal !== "number" ||
    !Number.isInteger(ordinal) ||
    ordinal < 0 ||
    typeof expectedCount !== "number" ||
    !Number.isInteger(expectedCount) ||
    expectedCount < 0 ||
    ordinal >= expectedCount
  )
    throw new Error("invalid history record ordinal/count");
  if (!value.payload || typeof value.payload !== "object")
    throw new Error("missing history record payload");
  if (
    typeof value.payloadJson !== "string" ||
    !SHA256.test(value.payloadSha256 ?? "") ||
    sha256(value.payloadJson) !== value.payloadSha256 ||
    stablePayloadJson(value.payload) !== value.payloadJson
  )
    throw new Error("history record payload digest mismatch");
  return value as RecordEnvelope;
}

export function parseBarrierEnvelope(raw: string): HistoryBarrier {
  const value = JSON.parse(raw) as Partial<HistoryBarrier>;
  if (value.version !== 1 || value.type !== "barrier")
    throw new Error("invalid history barrier envelope");
  assertStream(value.stream);
  if (!value.accountNo || !value.chunkId || value.parentChunkId === undefined)
    throw new Error("incomplete history barrier envelope");
  const recordCount = value.recordCount;
  if (
    typeof recordCount !== "number" ||
    !Number.isInteger(recordCount) ||
    recordCount < 0 ||
    !SHA256.test(value.recordsSha256 ?? "")
  )
    throw new Error("invalid history barrier count/digest");
  assertRawCursor(value.dealCursor, "deal");
  assertRawCursor(value.orderCursor, "order");
  if (typeof value.reachedPresent !== "boolean")
    throw new Error("invalid history barrier tail flag");
  return value as HistoryBarrier;
}

export function emptyRecordsSha256() {
  return sha256("");
}

export function nextRecordsSha256(previous: string, payloadSha256: string) {
  if (!SHA256.test(previous) || !SHA256.test(payloadSha256))
    throw new Error("invalid rolling history digest");
  return sha256(`${previous}:${payloadSha256}`);
}
