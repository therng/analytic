import { mergeLiveEquityPoint, mapEquitySnapshotRowsToPoints } from './equity-curve';
import { convertBangkokReportTimeToTableDate } from '@/lib/time';
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

// --- Table-time conversion coverage (finding #1) ---
//
// Real UTC 2026-07-01T10:00:00.000Z is Bangkok wall-clock 17:00 (UTC+7).
// Table-time re-encodes that wall-clock as if it were UTC minus 4h:
// 17:00 - 4h = 13:00, i.e. table-time = real UTC + 3h exactly.

test('mapEquitySnapshotRowsToPoints converts a DB row ts (real UTC) into table-time x', () => {
  const rows = [
    { ts: new Date('2026-07-01T10:00:00.000Z'), equity: 5000 },
  ];
  const result = mapEquitySnapshotRowsToPoints(rows);
  assert.equal(result.length, 1);
  assert.equal(result[0].x, '2026-07-01T13:00:00.000Z');
  assert.equal(result[0].y, 5000);
  assert.equal(result[0].balance, 5000);
});

test('mapEquitySnapshotRowsToPoints converts multiple rows preserving order', () => {
  const rows = [
    { ts: new Date('2026-07-01T09:00:00.000Z'), equity: 100 },
    { ts: new Date('2026-07-01T10:30:00.000Z'), equity: 200 },
  ];
  const result = mapEquitySnapshotRowsToPoints(rows);
  assert.equal(result[0].x, '2026-07-01T12:00:00.000Z');
  assert.equal(result[1].x, '2026-07-01T13:30:00.000Z');
});

test('live-merge path: converting a real-UTC "now" to table-time before merging lines up with converted DB rows', () => {
  // DB row at real UTC 09:00Z -> table-time 12:00Z.
  const points = mapEquitySnapshotRowsToPoints([
    { ts: new Date('2026-07-01T09:00:00.000Z'), equity: 100 },
  ]);
  assert.equal(points[0].x, '2026-07-01T12:00:00.000Z');

  // "now" is real UTC 10:00Z -> table-time 13:00Z, 1 hour after the last
  // point in the same (table-time) base, so it should be appended, not
  // dropped or misaligned.
  const now = new Date('2026-07-01T10:00:00.000Z');
  const liveTableDate = convertBangkokReportTimeToTableDate(now);
  const result = mergeLiveEquityPoint(points, liveTableDate, 150);

  assert.equal(result.length, 2);
  assert.equal(result[1].x, '2026-07-01T13:00:00.000Z');
  assert.equal(result[1].y, 150);
});
