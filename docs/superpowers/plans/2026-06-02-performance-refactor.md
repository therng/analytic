# Performance Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Improve dashboard performance and clean up trading logic duplication.

**Architecture:** Extract core logic into a modular library, implement incremental worker updates, and server-side chart downsampling.

**Tech Stack:** Next.js, Prisma, TypeScript, Node.js

---

### Task 1: Refactor Core Calculation Logic (Growth)

**Files:**
- Create: `src/lib/trading/core/growth.ts`
- Modify: `src/lib/trading/analytics.ts`
- Test: `src/lib/trading/core/growth.test.ts`

- [x] **Step 1: Write the failing test for growth calculations**

```typescript
import { computeAbsoluteGain } from './growth';
import { assert } from 'node:assert/strict';
import test from 'node:test';

test('computeAbsoluteGain calculates correctly', () => {
  const result = computeAbsoluteGain(100, 110);
  assert.equal(result, 10);
});
```

- [x] **Step 2: Run test to verify failure**

Run: `node --import tsx src/lib/trading/core/growth.test.ts`
Expected: FAIL (module not found)

- [x] **Step 3: Implement computeAbsoluteGain**

```typescript
export function computeAbsoluteGain(start: number, end: number) {
  return end - start;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --import tsx src/lib/trading/core/growth.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/trading/core/growth.ts src/lib/trading/core/growth.test.ts
git commit -m "refactor: extract growth core logic"
```

---

### Task 2: Implement Server-Side Downsampling (LTTB)

**Files:**
- Create: `src/lib/trading/core/downsample.ts`
- Test: `src/lib/trading/core/downsample.test.ts`

- [x] **Step 1: Write the failing test for downsampling**

```typescript
import { downsampleLTTB } from './downsample';
import { assert } from 'node:assert/strict';
import test from 'node:test';

test('downsampleLTTB reduces points correctly', () => {
  const data = Array.from({ length: 100 }, (_, i) => ({ x: i, y: Math.random() }));
  const sampled = downsampleLTTB(data, 10);
  assert.equal(sampled.length, 10);
});
```

- [x] **Step 2: Run test to verify failure**

Run: `node --import tsx src/lib/trading/core/downsample.test.ts`
Expected: FAIL

- [x] **Step 3: Implement LTTB algorithm**

```typescript
export function downsampleLTTB<T extends { x: number; y: number }>(data: T[], threshold: number): T[] {
  if (threshold >= data.length || threshold <= 0) return data;
  
  const sampled: T[] = [];
  sampled.push(data[0]); // Always keep the first point

  const bucketSize = (data.length - 2) / (threshold - 2);
  let a = 0;
  let nextA = 0;

  for (let i = 0; i < threshold - 2; i++) {
    let avgX = 0;
    let avgY = 0;
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgRangeEnd = Math.floor((i + 2) * bucketSize) + 1;
    const avgRangeLength = avgRangeEnd - avgRangeStart;

    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += data[j].x;
      avgY += data[j].y;
    }
    avgX /= avgRangeLength;
    avgY /= avgRangeLength;

    const rangeStart = Math.floor(i * bucketSize) + 1;
    const rangeEnd = Math.floor((i + 1) * bucketSize) + 1;

    const pointAX = data[a].x;
    const pointAY = data[a].y;

    let maxArea = -1;
    let area = -1;

    for (let j = rangeStart; j < rangeEnd; j++) {
      area = Math.abs((pointAX - avgX) * (data[j].y - pointAY) - (pointAX - data[j].x) * (avgY - pointAY)) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        nextA = j;
      }
    }

    sampled.push(data[nextA]);
    a = nextA;
  }

  sampled.push(data[data.length - 1]); // Always keep the last point
  return sampled;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --import tsx src/lib/trading/core/downsample.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/trading/core/downsample.ts src/lib/trading/core/downsample.test.ts
git commit -m "feat: add server-side downsampling"
```
