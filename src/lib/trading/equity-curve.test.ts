import { mergeLiveEquityPoint } from './equity-curve';
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
