import { test } from 'node:test';
import assert from 'node:assert';
import { buildPipsSummaryRows, buildRealtime24HourBalanceCurve, parsePositionHistoryPageOptions } from './preaggregated-cache';
import { type DealRow } from './preaggregated-cache';

// Helper to create a deal row
const createDeal = (time: string, balance: number | null, net: number, type: string = 'trade'): DealRow => ({
  time: new Date(time),
  type,
  profit: net,
  commission: 0,
  swap: 0,
  fee: 0,
  balanceAfter: balance,
});

test('buildRealtime24HourBalanceCurve fallback incremental', () => {
  const reportTime = new Date('2026-07-08T00:00:00Z');

  // 1. Deal with balanceAfter
  const deals1 = [createDeal('2026-07-08T01:00:00Z', 1050, 50)];
  const curve1 = buildRealtime24HourBalanceCurve(deals1, reportTime, 1050, 1000);
  assert.strictEqual(curve1[1].balance, 1050);

  // 2. Deal without balanceAfter (incremental fallback)
  const deals2 = [
      createDeal('2026-07-08T01:00:00Z', null, 50) // No balanceAfter, should be 1050 (snapshot 1000 + 50)
  ];
  const curve2 = buildRealtime24HourBalanceCurve(deals2, reportTime, 1050, 1000);
  assert.strictEqual(curve2[1].balance, 1050);

  // 3. Mixed deals
  const deals3 = [
      createDeal('2026-07-08T01:00:00Z', null, 50),
      createDeal('2026-07-08T02:00:00Z', 1200, 100) // Snap
  ];
  const curve3 = buildRealtime24HourBalanceCurve(deals3, reportTime, 1200, 1000);
  assert.strictEqual(curve3[1].balance, 1050);
  assert.strictEqual(curve3[2].balance, 1200);
});

test('buildRealtime24HourBalanceCurve commission/swap/fee included', () => {
  const reportTime = new Date('2026-07-08T00:00:00Z');
  const deals = [{
      time: new Date('2026-07-08T01:00:00Z'),
      type: 'trade',
      profit: 100,
      commission: -10,
      swap: -5,
      fee: -2,
      balanceAfter: null // should be 1000 + (100 - 10 - 5 - 2) = 1083
  }];
  const curve = buildRealtime24HourBalanceCurve(deals as any, reportTime, 1083, 1000);
  assert.strictEqual(curve[1].balance, 1083);
});

test('buildRealtime24HourBalanceCurve no deals in 24h', () => {
    const reportTime = new Date('2026-07-08T00:00:00Z');
    const deals: DealRow[] = [];
    const curve = buildRealtime24HourBalanceCurve(deals, reportTime, 1000, 1000);
    assert.strictEqual(curve.length, 2);
    assert.strictEqual(curve[0].balance, 1000);
    assert.strictEqual(curve[1].balance, 1000);
});

test('buildPipsSummaryRows includes all history and prefers stored position pips', () => {
  const rows = buildPipsSummaryRows(
    [],
    [
      {
        closeTime: new Date('2025-12-31T12:00:00.000Z'),
        volume: 0.2,
        pips: 17.5,
      },
      {
        closeTime: new Date('2026-07-10T12:00:00.000Z'),
        volume: 0.1,
        pips: -2,
      },
    ],
    new Date('2026-07-11T12:00:00.000Z'),
  );

  const yearRow = rows.find((row) => row.label === 'ปีนี้');
  const allRow = rows.find((row) => row.label === 'ทั้งหมด');

  assert.ok(yearRow);
  assert.ok(allRow);
  assert.strictEqual(yearRow.pips, -2);
  assert.strictEqual(allRow.pips, 15.5);
  assert.ok(Math.abs(allRow.volume - 0.3) < 0.000001);
});

test('parsePositionHistoryPageOptions normalizes limits and handles allHistory', () => {
  // 1. Regular limit
  const normalOpts = parsePositionHistoryPageOptions(new URLSearchParams('limit=100'));
  assert.strictEqual(normalOpts.limit, 100);

  // 2. Clamped limit (default is max 250)
  const clampedOpts = parsePositionHistoryPageOptions(new URLSearchParams('limit=500'));
  assert.strictEqual(clampedOpts.limit, 250);

  // 3. allHistory scope bypasses max 250 clamp
  const scopeOpts = parsePositionHistoryPageOptions(new URLSearchParams('limit=10000&scope=allHistory'));
  assert.strictEqual(scopeOpts.limit, 10000);

  // 4. ignoreDashboardTimeframe bypasses max 250 clamp
  const ignoreOpts = parsePositionHistoryPageOptions(new URLSearchParams('limit=50000&ignoreDashboardTimeframe=true'));
  assert.strictEqual(ignoreOpts.limit, 50000);

  // 5. timeframe=all bypasses max 250 clamp
  const timeframeOpts = parsePositionHistoryPageOptions(new URLSearchParams('limit=99999&timeframe=all'));
  assert.strictEqual(timeframeOpts.limit, 99999);
});
