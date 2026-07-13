import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAccountRegistry, resolveAccountByLogin } from "./account-registry.ts";

function fakePrisma(rows: any[]) {
  return {
    tradingAccount: {
      findMany: async () => rows,
    },
  } as any;
}

test("loadAccountRegistry keys accounts by accountNo and excludes unconfigured offsets", async () => {
  const prisma = fakePrisma([
    { id: "a1", accountNo: "1001", brokerUtcOffsetMinutes: 180 },
    { id: "a2", accountNo: "1002", brokerUtcOffsetMinutes: null },
  ]);
  const registry = await loadAccountRegistry(prisma);
  assert.equal(registry.size, 1);
  assert.equal(registry.get("1001")?.id, "a1");
  assert.equal(registry.has("1002"), false);
});

test("resolveAccountByLogin coerces numeric login to string lookup", async () => {
  const prisma = fakePrisma([{ id: "a1", accountNo: "1001", brokerUtcOffsetMinutes: 180 }]);
  const registry = await loadAccountRegistry(prisma);
  assert.equal(resolveAccountByLogin(registry, 1001)?.id, "a1");
  assert.equal(resolveAccountByLogin(registry, "1001")?.id, "a1");
  assert.equal(resolveAccountByLogin(registry, 9999), null);
});
