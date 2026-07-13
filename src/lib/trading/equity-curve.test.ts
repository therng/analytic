import { Prisma } from '@prisma/client';
import { mergeLiveEquityPoint, mapEquitySnapshotRowsToPoints } from './equity-curve';
import assert from 'node:assert/strict';
import test from 'node:test';

test('mergeLiveEquityPoint appends a new point after the last historical point', () => {
  const points = [
    { x: '2026-07-01T02:00:00.000Z', y: 1000, balance: 1000, eventType: null, eventDelta: null },
  ];
  const liveTimestamp = new Date('2026-07-01T03:00:00.000Z');
  const result = mergeLiveEquityPoint(points, liveTimestamp, 1050);
  assert.equal(result.length, 2);
  assert.equal(result[1].y, 1050);
  assert.equal(result[1].x, liveTimestamp.toISOString());
});

test('mergeLiveEquityPoint replaces the last point when within 60 seconds', () => {
  const points = [
    { x: '2026-07-01T03:00:10.000Z', y: 1000, balance: 1000, eventType: null, eventDelta: null },
  ];
  const liveTimestamp = new Date('2026-07-01T03:00:40.000Z');
  const result = mergeLiveEquityPoint(points, liveTimestamp, 1010);
  assert.equal(result.length, 1);
  assert.equal(result[0].y, 1010);
});

test('mergeLiveEquityPoint returns points unchanged when live data is missing', () => {
  const points = [
    { x: '2026-07-01T03:00:00.000Z', y: 1000, balance: 1000, eventType: null, eventDelta: null },
  ];
  const result = mergeLiveEquityPoint(points, null, null);
  assert.equal(result, points);
});

test('mergeLiveEquityPoint returns a single point when there is no history', () => {
  const liveTimestamp = new Date('2026-07-01T03:00:00.000Z');
  const result = mergeLiveEquityPoint([], liveTimestamp, 1234);
  assert.equal(result.length, 1);
  assert.equal(result[0].y, 1234);
});

// --- Real-UTC pass-through coverage ---
//
// EquitySnapshot.ts is a genuine real-UTC instant (written by the worker's
// own clock). Deal/Position timestamps are also genuine real-UTC after the
// broker-timezone refactor (converted via serverTimeToUtc at persistence
// time), so no table-time re-encoding is needed anywhere in this path.

test('mapEquitySnapshotRowsToPoints passes a DB row ts (real UTC) through unchanged', () => {
  const rows = [
    { ts: new Date('2026-07-01T10:00:00.000Z'), equity: new Prisma.Decimal(5000) },
  ];
  const result = mapEquitySnapshotRowsToPoints(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].x, '2026-07-01T10:00:00.000Z');
  assert.equal(result[0].y, 5000);
  assert.equal(result[0].balance, 5000);
});

test('mapEquitySnapshotRowsToPoints preserves order for multiple rows', () => {
  const rows = [
    { ts: new Date('2026-07-01T09:00:00.000Z'), equity: new Prisma.Decimal(100) },
    { ts: new Date('2026-07-01T10:30:00.000Z'), equity: new Prisma.Decimal(200) },
  ];
  const result = mapEquitySnapshotRowsToPoints(rows);
  assert.equal(result[0].x, '2026-07-01T09:00:00.000Z');
  assert.equal(result[1].x, '2026-07-01T10:30:00.000Z');
});

test('live-merge path: a real-UTC "now" lines up with real-UTC DB rows with no conversion', () => {
  const points = mapEquitySnapshotRowsToPoints([
    { ts: new Date('2026-07-01T09:00:00.000Z'), equity: new Prisma.Decimal(100) },
  ]);
  assert.equal(points[0].x, '2026-07-01T09:00:00.000Z');

  // "now" is real UTC 10:00Z, 1 hour after the last point, so it should be
  // appended, not dropped or misaligned.
  const now = new Date('2026-07-01T10:00:00.000Z');
  const result = mergeLiveEquityPoint(points, now, 150);

  assert.equal(result.length, 2);
  assert.equal(result[1].x, '2026-07-01T10:00:00.000Z');
  assert.equal(result[1].y, 150);
});
