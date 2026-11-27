# Contributing

Thanks for taking the time. OwnTube is a solo side-project, so my main goal is to keep the codebase boring and easy to maintain. PRs that simplify things are usually the most welcome.

## Before you start

- For non-trivial changes, please open an issue first so we can agree on the approach. It avoids throwaway work on both sides.
- The product spec and priorities are in [base.md](base.md). Anything outside of that scope (microservices, Redis, collaborative filtering, ad networks, telemetry, …) won't be merged.

## Local setup

```bash
cp .env.example .env
corepack enable && corepack prepare pnpm@9.15.9 --activate
pnpm install
pnpm run db:migrate
pnpm dev
```

Run the gateway next to the web app (`pnpm dev:gateway`); it is the only part that talks to YouTube.

## Workflow

1. Fork and create a branch from `main`. Use a short topic name like `feat/playlist-shuffle` or `fix/search-empty-query`.
2. Make small, focused commits. Conventional Commit messages are appreciated (`feat:`, `fix:`, `refactor:`, `docs:`, …) but not strictly required.
3. Run the full check before pushing:
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm test:e2e   # requires `pnpm exec playwright install` once
   pnpm build
   ```
4. Open a PR. Explain the *why* — the *what* is in the diff.

## Code style

- TypeScript strict mode. No `any`, no `as unknown as X`.
- Functions short, names explicit. Long files are usually a refactor opportunity, not a feature.
- No `console.log` in shipped code. Use `src/lib/logger.ts`.
- Server Components by default; only add `"use client"` when you actually need browser-only APIs.
- Don't fetch data from `useEffect`. Use tRPC + React Query, or do it server-side.
- Validate every tRPC input with Zod. Don't skip it for "simple" routes.
- Do not introduce barrel `index.ts` files that re-export everything.
- Biome is the linter and formatter. ESLint and Prettier are out.

## Tests

- New behaviour ideally comes with a Vitest test. Look at the existing `*.test.ts` files for the style.
- For UI flows, the Playwright smoke test in `e2e/smoke.spec.ts` is the model.
- Tests are expected to be deterministic. If you need a clock or RNG, inject it.

## Database changes

- Edit the schema in `src/server/db/schema.ts`.
- Run `pnpm db:generate` to produce a migration in `src/server/db/migrations/`.
- Migrations must be additive when possible. No destructive changes to existing user data without a clear migration path.

## Commit hygiene

- Don't commit `.env`, `data/*.db`, `youtube-takeout/`, `test-results/`, or `.next/` outputs. The `.gitignore` already covers these.
- One logical change per commit. If your PR contains a refactor *and* a feature, split them.

## Reporting bugs

Please include:
- OwnTube commit / version
- Node version, pnpm version
- Your `GATEWAY_EGRESS_FAMILY` and the gateway's log around the failure (no secrets)
- Steps to reproduce
- Relevant logs (`LOG_LEVEL=debug` is helpful)

## Security

If you find a vulnerability, **do not** open a public issue. See [SECURITY.md](SECURITY.md).
