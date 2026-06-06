# TypeScript / JavaScript Style Guide

Based on existing ESLint config (eslint-config-next) + project conventions.

## Formatting
- **Indent**: 2 spaces
- **Semicolons**: required
- **Quotes**: double quotes (`"`)
- **Import alias**: use `@/` for src-relative imports

## Naming
- `PascalCase` — React components, TypeScript types/interfaces
- `camelCase` — functions, hooks, variables, props
- `SCREAMING_SNAKE_CASE` — constants only when truly constant and global

## TypeScript
- Prefer explicit return types on exported functions
- Use `Prisma.Decimal` for monetary values in worker/DB layer; convert to `number` only at serialization boundary
- Avoid `any`; use `unknown` + narrowing when type is genuinely unknown
- No `// @ts-ignore` without an explanatory comment

## React / Next.js
- Use App Router patterns (Server Components by default, `"use client"` only when needed)
- Keep components in `src/components/trading-monitor/`
- Co-locate `*.test.ts` files with the component/module they test
- Avoid prop drilling beyond 2 levels — lift state or use context

## Financial Precision Rules
- `positionNetPnl = profit + swap + commission` — always include all three
- Never mix compact and full currency formatting on the same metric surface
- All date/time operations must go through `src/lib/time.ts` (Asia/Bangkok, UTC+7)

## Comments
- Write comments only when the WHY is non-obvious
- No multi-line docstrings; one short line max
- No TODO comments committed — resolve or create a track task instead

## Testing
- Run with: `node --import tsx --test <file>.test.ts`
- Test financial/analytics logic; skip trivial UI wiring
- Use real data fixtures, not mocks, for parser and analytics tests
