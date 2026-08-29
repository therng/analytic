#!/usr/bin/env node
// docs-impact.mjs — map changed source paths in the analytic repo to the
// documentation files they may invalidate.
//
// Usage (run from anywhere, pass --repo; default repo = cwd):
//   node docs-impact.mjs [--repo <path>] [--diff <spec>] [--check]
//
// --diff spec:
//   WORKTREE          uncommitted changes vs HEAD (default); covers staged +
//                     unstaged tracked files; untracked files are invisible
//   A..B              explicit git range, e.g. HEAD~1..HEAD
//   <rev>             files changed by that single commit (diff-tree)
//
// Modes:
//   report (default)  print path -> doc-target mapping
//   --check           exit 0 = no doc impact, or every impacted doc is
//                       already touched in the same diff
//                       exit 1 = impacted docs NOT touched (review before
//                       committing; advisory, not proof of drift)
//                       exit 2 = usage or git error
//
// Zero dependencies. Windows-safe (path.resolve, execFileSync, no shell).

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

// First matching rule wins per path — specific rules before prefixes.
const RULES = [
  {
    match: (p) => p === 'src/lib/trading/metric-registry.ts',
    targets: ['AGENTS.md'],
    why: 'metric display mappings are documented in AGENTS.md',
  },
  {
    match: (p) => p.startsWith('prisma/'),
    targets: ['CLAUDE.md', 'docs/architecture-data-models.md', 'docs/ARCHITECTURE.md'],
    why: 'schema / data-model docs',
  },
  {
    match: (p) => p.startsWith('bridge/'),
    targets: [
      'docs/ARCHITECTURE.md',
      'docs/architecture-data-models.md',
      'docs/mql5book-deal-properties.md',
      'docs/mql5book-order-properties.md',
      'docs/mql5book-position-properties.md',
    ],
    why: 'bridge envelope / history property docs',
  },
  {
    match: (p) => p.startsWith('src/worker-v2/'),
    targets: ['docs/ARCHITECTURE.md', 'docs/decisions/0002-worker-v2-adoption.md'],
    why: 'worker architecture (ADR is read-only reference)',
  },
  {
    match: (p) => p.startsWith('src/lib/trading/'),
    targets: ['docs/ARCHITECTURE.md', 'AGENTS.md'],
    why: 'analytics behavior rules live in AGENTS.md',
  },
  {
    match: (p) =>
      p.startsWith('src/components/trading-monitor/') || p.startsWith('src/app/'),
    targets: ['AGENTS.md'],
    why: 'dashboard behavior / visual rules live in AGENTS.md',
  },
  {
    match: (p) => p.startsWith('scripts/'),
    targets: ['CLAUDE.md'],
    why: 'commands / workflow docs',
  },
  {
    match: (p) => p === 'package.json',
    targets: ['CLAUDE.md', 'README.md'],
    why: 'commands + project overview',
  },
  {
    match: (p) => p.startsWith('next.config'),
    targets: ['docs/ARCHITECTURE.md', 'CLAUDE.md'],
    why: 'build / serve architecture + stack docs',
  },
  {
    match: (p) => p === '.env.example',
    targets: ['CLAUDE.md'],
    why: 'env var docs',
  },
];

const CHANGELOG = 'CHANGELOG.md';

function parseArgs(argv) {
  const args = { diff: 'WORKTREE', check: false, repo: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--diff') args.diff = argv[++i] ?? fail('--diff needs a value');
    else if (a === '--repo') args.repo = argv[++i] ?? fail('--repo needs a value');
    else fail(`unknown argument: ${a}`);
  }
  return args;
}

function fail(msg) {
  console.error(`docs-impact: ${msg}`);
  process.exit(2);
}

function git(repo, args) {
  try {
    return execFileSync('git', ['-C', path.resolve(repo), ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    fail(`git ${args.join(' ')} failed: ${String(err.stderr || err.message).trim()}`);
    return '';
  }
}

function changedPaths(repo, spec) {
  let out;
  if (spec === 'WORKTREE') {
    out = git(repo, ['diff', '--name-only', 'HEAD']);
  } else if (spec.includes('..')) {
    out = git(repo, ['diff', '--name-only', spec]);
  } else {
    out = git(repo, ['diff-tree', '--no-commit-id', '--name-only', '-r', spec]);
  }
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

const isDoc = (p) => p.endsWith('.md') || p.startsWith('docs/') || p.startsWith('specs/');

function main() {
  const { repo, diff, check } = parseArgs(process.argv.slice(2));
  const changed = changedPaths(repo, diff);
  const touched = new Set(changed);
  const sourcePaths = changed.filter((p) => !isDoc(p));

  console.log(`docs-impact: repo=${path.resolve(repo)} diff=${diff}`);
  if (sourcePaths.length === 0) {
    console.log('no doc impact (no source files in diff)');
    process.exit(0);
  }

  // path -> [{ target, why }], union across rules (first-match per path is a
  // single rule, but multiple paths hit different rules)
  const targets = new Map(); // target -> Set(reasons)
  for (const p of sourcePaths) {
    const rule = RULES.find((r) => r.match(p));
    const hits = rule ? rule.targets : [];
    for (const t of hits) {
      if (!targets.has(t)) targets.set(t, new Set());
      targets.get(t).add(`${p} (${rule.why})`);
    }
  }
  if (!targets.has(CHANGELOG)) {
    targets.set(CHANGELOG, new Set(['<source changes> (release notes)']));
  }

  for (const [t, reasons] of [...targets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const state = touched.has(t) ? 'touched-in-diff' : 'PENDING';
    console.log(`  ${t} [${state}]`);
    for (const r of [...reasons].sort()) console.log(`    <- ${r}`);
  }

  const pending = [...targets.keys()].filter((t) => !touched.has(t)).sort();
  if (!check) {
    if (pending.length) console.log(`pending review: ${pending.length} doc file(s)`);
    process.exit(0);
  }
  if (pending.length === 0) {
    console.log('check OK: all impacted docs touched in this diff');
    process.exit(0);
  }
  console.log(`check PENDING (${pending.length}): review before commit —`);
  for (const t of pending) console.log(`  - ${t}`);
  process.exit(1);
}

main();
