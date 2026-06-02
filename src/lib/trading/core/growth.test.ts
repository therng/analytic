import { computeAbsoluteGain } from './growth';
import assert from 'node:assert/strict';
import test from 'node:test';

test('computeAbsoluteGain calculates correctly', () => {
  const result = computeAbsoluteGain(100, 110);
  assert.equal(result, 10);
});
