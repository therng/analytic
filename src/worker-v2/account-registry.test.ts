import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAccountRegistry, resolveAccountByLogin } from "./account-registry";

function fakePrisma(rows: any[]) {
  return {
    tradingAccount: {
      findMany: async () => rows,
    },
  } as any;
}

test("loadAccountRegistry keys accounts by accountNo and includes accounts with unconfigured offsets", async () => {
  const prisma = fakePrisma([
    { id: "a1", accountNo: "1001", brokerUtcOffsetMinutes: 180 },
    { id: "a2", accountNo: "1002", brokerUtcOffsetMinutes: null },
  ]);
  const registry = await loadAccountRegistry(prisma);
  assert.equal(registry.size, 2);
  assert.equal(registry.get("1001")?.id, "a1");
  assert.equal(registry.has("1002"), true);
});

test("resolveAccountByLogin coerces numeric login to string lookup", async () => {
  const prisma = fakePrisma([{ id: "a1", accountNo: "1001", brokerUtcOffsetMinutes: 180 }]);
  const registry = await loadAccountRegistry(prisma);
  assert.equal(resolveAccountByLogin(registry, 1001)?.id, "a1");
  assert.equal(resolveAccountByLogin(registry, "1001")?.id, "a1");
  assert.equal(resolveAccountByLogin(registry, 9999), null);
});

test("loadAccountRegistry includes accounts with null brokerUtcOffsetMinutes", async () => {
  const prisma = {
    tradingAccount: {
      findMany: async () => [
        { id: "a1", accountNo: "1001", brokerUtcOffsetMinutes: 180 },
        { id: "a2", accountNo: "1002", brokerUtcOffsetMinutes: null },
      ],
    },
  } as any;
  const registry = await loadAccountRegistry(prisma);
  assert.equal(registry.size, 2);
  assert.equal(registry.get("1002")?.brokerUtcOffsetMinutes, null);
});
