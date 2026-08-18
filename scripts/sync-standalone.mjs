// Copies runtime assets into .next/standalone so `node .next/standalone/server.js`
// serves a complete app. Next.js emits the standalone server WITHOUT .next/static
// and public/ by design — without this sync the standalone build serves HTML whose
// CSS/JS 404 (verified on the forexvps single-host deployment).
// Runs as part of `npm run build`; safe to re-run (idempotent copy).
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");

if (!existsSync(path.join(standalone, "server.js"))) {
  console.error("sync-standalone: .next/standalone/server.js missing — run `next build` first");
  process.exit(1);
}

cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
console.log("sync-standalone: copied .next/static + public/ into .next/standalone");
