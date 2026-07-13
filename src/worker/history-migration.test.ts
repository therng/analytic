import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260713120000_add_bridge_history_checkpoints/migration.sql",
  "utf8",
);

test("TradingAccount maps to PostgreSQL Account table with unmapped id column", () => {
  const model = schema.match(/model TradingAccount \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(model, "TradingAccount model missing");
  assert.match(model, /\bid\s+String\s+@id\b/);
  assert.doesNotMatch(model, /\bid\s+String[^\n]*@map\(/);
  assert.match(model, /@@map\("Account"\)/);
});

test("history migration foreign keys target Account(id) and use cascading deletes", () => {
  const accountReferences = migration.match(
    /FOREIGN KEY \("account_id"\) REFERENCES "Account"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE/g,
  ) ?? [];
  assert.equal(accountReferences.length, 2);
  assert.doesNotMatch(migration, /REFERENCES "TradingAccount"/);
  assert.match(
    migration,
    /FOREIGN KEY \("chunk_id"\) REFERENCES "BridgeHistoryChunk"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE/,
  );
});

test("history migration uses timezone-aware audit timestamps and raw BIGINT server cursors", () => {
  assert.equal((migration.match(/TIMESTAMPTZ\(3\)/g) ?? []).length, 10);
  assert.doesNotMatch(migration, /(?<!TZ)TIMESTAMP\(3\)/);
  assert.equal((migration.match(/server_time" BIGINT/g) ?? []).length, 4);
  assert.match(migration, /"deals_cursor_ticket" BIGINT/);
  assert.match(migration, /"orders_cursor_ticket" BIGINT/);
});
