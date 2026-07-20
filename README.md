# ai-quiz

An AI agent that turns any markdown document into an interactive multiple-choice quiz, then chats with the user about what they got wrong.

This repository is a **pnpm-workspace monorepo** built on a hexagonal architecture (NestJS + Drizzle + Mastra on the API, Next.js on the web, Zod schemas in `packages/shared`).

## Quick start

```bash
# Install deps (Node >=22.22.1 required)
pnpm install

# Spin up local Postgres
docker compose up -d

# Run the full verification gate (lint + typecheck + test + test:e2e + build)
pnpm verify
```

See [`project-context.md`](./_bmad-output/project-context.md) for the full implementation constitution, and [`ARCHITECTURE-SPINE.md`](./_bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md) for the architecture spine.

## Layout

```
apps/
  api/      NestJS + Mastra + Drizzle (apps/api/src/{domain,adapters,driving})
  web/      Next.js (App Router)
packages/
  shared/   Zod schemas + scoring (pure)
  eslint-plugin-local/  Internal ESLint plugin harness for project-specific rules
```

## Toolchain

- Node `>=22.22.1`
- pnpm `>=11`
- TypeScript `~6.0.3` (`>=6.0.3 <6.1.0`) — TS 7.0+ breaks typescript-eslint
- ESLint 10.7.0 (flat config; eslintrc removed)
- Vitest 4.1.10 (uses `test.projects`, not `vitest.workspace.ts`)

See [`ARCHITECTURE-SPINE.md`](./_bmad-output/planning-artifacts/architecture/architecture-ai-quiz-2026-07-16/ARCHITECTURE-SPINE.md) → "Toolchain traps" for the full version-trap table.
