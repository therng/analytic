import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRecordEnvelope,
  parseBarrierEnvelope,
  parseRecordEnvelope,
} from "./bridge-protocol";

test("record envelope preserves raw server time and deterministic ordinal metadata", () => {
  const envelope = buildRecordEnvelope({
    accountNo: "123",
    stream: "deals",
    chunkId: "chunk-1",
    parentChunkId: null,
    ordinal: 0,
    expectedCount: 1,
    eventKey: "deal:7",
    payload: { ticket: 7, time: 946684800 },
    windowStartServerTime: "946684800",
    windowEndServerTime: "949276800",
    dealCursor: { time: "946684800", ticket: "7" },
    orderCursor: { time: "946684800", ticket: "0" },
  });

  assert.equal(envelope.type, "record");
  assert.equal(envelope.payload.time, 946684800);
  assert.equal(envelope.windowStartServerTime, "946684800");
  assert.deepEqual(envelope.dealCursor, { time: "946684800", ticket: "7" });
  assert.equal(parseRecordEnvelope(JSON.stringify(envelope)).eventKey, "deal:7");
});

test("record envelope rejects missing target cursors", () => {
  const envelope = buildRecordEnvelope({
    accountNo: "123",
    stream: "deals",
    chunkId: "chunk-1",
    parentChunkId: null,
    ordinal: 0,
    expectedCount: 1,
    eventKey: "deal:7",
    payload: { ticket: 7, time: 946684800 },
    windowStartServerTime: "946684800",
    windowEndServerTime: "949276800",
    dealCursor: { time: "946684800", ticket: "7" },
    orderCursor: { time: "946684800", ticket: "0" },
  });
  const withoutCursor = { ...envelope } as Partial<typeof envelope>;
  delete withoutCursor.dealCursor;

  assert.throws(() => parseRecordEnvelope(JSON.stringify(withoutCursor)), /deal cursor/);
});

test("record envelope rejects payload that differs from hashed payloadJson", () => {
  const envelope = buildRecordEnvelope({
    accountNo: "123", stream: "deals", chunkId: "chunk-1", parentChunkId: null,
    ordinal: 0, expectedCount: 1, eventKey: "deal:7",
    payload: { ticket: 7, time: 946684800 },
    windowStartServerTime: "946684800", windowEndServerTime: "949276800",
    dealCursor: { time: "946684800", ticket: "7" },
    orderCursor: { time: "946684800", ticket: "0" },
  });
  envelope.payload.time = 1_700_000_000;

  assert.throws(() => parseRecordEnvelope(JSON.stringify(envelope)), /payload digest mismatch/);
});

test("barrier rejects missing records and malformed digest", () => {
  assert.throws(() => parseBarrierEnvelope(JSON.stringify({
    version: 1,
    type: "barrier",
    stream: "deals",
    chunkId: "chunk-1",
    recordCount: 1,
    recordsSha256: "not-a-sha256",
  })));
});
