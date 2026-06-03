import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("prisma module import does not require DATABASE_URL during build-time evaluation", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "analytic-prisma-build-"));
  const previousCwd = process.cwd();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "   ";

  try {
    process.chdir(tempDir);

    await assert.doesNotReject(() =>
      import(`${pathToFileURL(path.join(previousCwd, "src/lib/prisma.ts")).href}?blank-database-url`),
    );
  } finally {
    process.chdir(previousCwd);

    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
});
