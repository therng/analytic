import { buildEquitySnapshotRow, buildPositionExcursionRows, truncateToMinute } from './equity-sampler';
import assert from 'node:assert/strict';
import test from 'node:test';

test('truncateToMinute zeroes out seconds and milliseconds', () => {
  const input = new Date('2026-07-01T03:45:27.812Z');
  const result = truncateToMinute(input);
  assert.equal(result.toISOString(), '2026-07-01T03:45:00.000Z');
});

test('buildEquitySnapshotRow maps live data to a snapshot row', () => {
  const ts = new Date('2026-07-01T03:45:00.000Z');
  const row = buildEquitySnapshotRow('acct-1', ts, {
    login: '12345',
    balance: 1000,
    equity: 1050,
    margin: 200,
    freeMargin: 850,
    marginLevel: 525,
    profit: 50,
    credit: 0,
    currency: 'USD',
  });
  assert.deepEqual(row, {
    tradingAccountId: 'acct-1',
    ts,
    equity: 1050,
    margin: 200,
    balance: 1000,
  });
});

test('buildPositionExcursionRows maps each open position to an excursion row', () => {
  const ts = new Date('2026-07-01T03:45:00.000Z');
  const rows = buildPositionExcursionRows('acct-1', ts, [
    { ticket: 111, symbol: 'EURUSD', type: 0, volume: 0.1, openPrice: 1.1, currentPrice: 1.11, sl: 0, tp: 0, profit: 12.5, swap: 0, comment: '', openTime: 0 },
    { ticket: 222, symbol: 'GBPUSD', type: 1, volume: 0.2, openPrice: 1.2, currentPrice: 1.19, sl: 0, tp: 0, profit: -8.25, swap: 0, comment: '', openTime: 0 },
  ]);
  assert.deepEqual(rows, [
    { tradingAccountId: 'acct-1', positionTicket: '111', ts, profit: 12.5 },
    { tradingAccountId: 'acct-1', positionTicket: '222', ts, profit: -8.25 },
  ]);
});

test('buildPositionExcursionRows returns an empty array for no open positions', () => {
  const ts = new Date('2026-07-01T03:45:00.000Z');
  assert.deepEqual(buildPositionExcursionRows('acct-1', ts, []), []);
});
