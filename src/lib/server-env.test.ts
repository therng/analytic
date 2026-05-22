import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("loadServerEnv loads DATABASE_URL from a local .env file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "analytic-env-"));
  const envPath = path.join(tempDir, ".env");
  const previousDatabaseUrl = process.env.DATABASE_URL;

  await writeFile(envPath, "DATABASE_URL=postgresql://tester:secret@localhost:5432/analytic_test\n", "utf8");
  delete process.env.DATABASE_URL;

  const { loadServerEnv, requireEnv } = await import("./server-env");

  loadServerEnv(tempDir, true);

  assert.equal(requireEnv("DATABASE_URL"), "postgresql://tester:secret@localhost:5432/analytic_test");

  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test("requireEnv throws a direct configuration error for missing values", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  const { requireEnv } = await import("./server-env");

  assert.throws(
    () => requireEnv("DATABASE_URL"),
    /DATABASE_URL is not configured\. Copy \.env\.example to \.env or export DATABASE_URL before running this process\./,
  );

  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
