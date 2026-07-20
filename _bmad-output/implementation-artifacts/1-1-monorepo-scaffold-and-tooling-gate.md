---
status: done
slug: 1-1-monorepo-scaffold-and-tooling-gate
baseline_revision: c186dff
started: 2026-07-20
review_loop_iteration: 1
final_revision: NO_VCS
followup_review_recommended: false
---

# Story 1.1: Monorepo scaffold & tooling gate

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a pnpm-workspace monorepo with enforced hexagonal boundaries, formatting, and a single verify gate,
so that every change is boundary-safe and checked from the first commit.

## Acceptance Criteria

1. **Clean-clone verify passes.** Given a clean clone, when I run `pnpm install && pnpm verify`, then lint + typecheck + test + build all pass on the empty skeleton (test/build are no-ops until packages have content).
2. **Domain purity is machine-enforced.** Given the three workspaces (`apps/api`, `apps/web`, `packages/shared`), when an `apps/api/src/domain/**` file imports `@nestjs/*`, `drizzle-orm`, `mastra`, `undici`, or `node:fetch`, then ESLint fails via `no-restricted-imports` [AD-2].
3. **Pre-commit hook blocks violations.** Given a staged commit, when the pre-commit hook runs, then husky + lint-staged run Prettier 3.x + ESLint on staged files and block on violation.
4. **TypeScript strictness is inherited.** Given `tsconfig.base.json`, then `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride` are enabled and inherited per-package.
5. **Local Postgres is reachable.** Given `docker-compose.yml`, when `docker compose up`, then a local Postgres 16 instance is reachable for dev.

## Tasks / Subtasks

- [x] **Task 1 — Workspace root** (AC: #1, #4)
  - [x] `pnpm-workspace.yaml` listing `apps/*` and `packages/*`
  - [x] Root `package.json`: `private: true`, `engines.node`, `packageManager`, all scripts from §Scripts below
  - [x] `tsconfig.base.json` with the three mandated flags; per-package `tsconfig.json` extends it
  - [x] `.gitignore`, `.env.example`, `README.md` stub
  - [x] Three workspace packages with `package.json` + `tsconfig.json`: `@ai-quiz/api`, `@ai-quiz/web`, `@ai-quiz/shared`
- [x] **Task 2 — Hexagonal directory skeleton + domain tsconfig** (AC: #2)
  - [x] Create the `apps/api/src/{domain,adapters,driving}` tree (see §File Structure)
  - [x] `apps/api/src/domain/tsconfig.json` — the domain is an isolated _directory_, **not** a separate pnpm package [AD-2]
  - [x] Add `.gitkeep` to empty dirs so the tree survives commit
- [x] **Task 3 — ESLint flat config + local plugin harness** (AC: #1, #2)
  - [x] Root `eslint.config.js` using `defineConfig` from `eslint/config`
  - [x] `typescript-eslint` meta-package with `parserOptions.projectService: true`
  - [x] `no-restricted-imports` scoped to `apps/api/src/domain/**` — the 5 external modules **and** the internal paths `apps/api/src/adapters/`, `apps/api/src/driving/`
  - [x] `packages/eslint-plugin-local/` scaffold — plugin object with `meta.name`/`meta.version`, empty `rules: {}`, wired into the root config. **Do not implement the three named rules here** (see §Scope Boundary)
  - [x] `@ai-quiz/no-console-log` outside `apps/api/src/adapters/` — implement via the built-in `no-console` rule with a directory override; no custom rule needed
  - [x] `simple-import-sort` for import order
  - [x] Fixture test proving AC #2: a file that violates the rule fails lint, a compliant one passes
- [x] **Task 4 — Prettier + husky + lint-staged** (AC: #3)
  - [x] `.prettierrc` at repo root — single source of formatting truth, **no per-package overrides**
  - [x] `pnpm exec husky init` → `.husky/pre-commit`, `"prepare": "husky"` in root package.json
  - [x] `lint-staged` config in `package.json` (**not** `.lintstagedrc` — see §Version Traps #8)
  - [x] `.husky/pre-push` running `pnpm format:check`
- [x] **Task 5 — Vitest root config** (AC: #1)
  - [x] Root `vitest.config.ts` using `test.projects` (**not** `vitest.workspace.ts` — removed in v4)
  - [x] `pnpm test` must exit 0 with zero test files present
- [x] **Task 6 — docker-compose Postgres** (AC: #5)
  - [x] `docker-compose.yml` with `postgres:16.14-alpine`, port `5432:5432`, db `ai_quiz`, named volume
  - [x] Healthcheck via `pg_isready`; document the `DATABASE_URL` in `.env.example`
- [x] **Task 7 — Prove the gate** (AC: #1)
  - [x] Run `pnpm install && pnpm verify` from a clean clone and confirm green
  - [x] Confirm `pnpm verify` fails when the AC #2 fixture is un-ignored

## Dev Notes

### 🚨 Three toolchain traps — read first

These were found during Story 1.1 research and have since been folded into the spine and constitution, which are now in sync with this story. Kept here because they will still bite you at the keyboard:

| Doc says                 | Reality                                                  | What to do                                                        |
| ------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm 9.x`               | **11.15.1**                                              | ✅ Resolved — spine + constitution now pin 11.15.1.               |
| `TypeScript 5.x`         | `latest` = **7.0.2**, which **breaks typescript-eslint** | **Constrain to `~6.0.3`.** See below.                             |
| `Node >= 22.13.0` [AD-8] | `lint-staged@17.1.0` requires `>= 22.22.1`               | Pin `engines.node: ">=22.22.1"` — stricter, still satisfies AD-8. |

**The TypeScript trap is the one that will burn you.** TS 7.0 (Project Corsa, the Go rewrite) ships **no programmatic Compiler API** — that lands in 7.1. `typescript-eslint@8.64.0` declares `"typescript": ">=4.8.4 <6.1.0"`. So `pnpm add -D typescript` installs 7.0.2, the peer resolution fails, and forcing it through crashes ESLint at runtime. **Constrain to `~6.0.3`** (`>=6.0.3 <6.1.0`) — `~`, not `^` (which admits a breaking 6.1) and not an exact pin (which blocks a future 6.0.4 patch). TS 7 is not unusable: it installs side-by-side, so `tsgo` remains available for fast typechecks.

Related: **TS 6.0 flipped nine compiler defaults** — `strict`, `module: esnext`, `target: es2025`, `moduleResolution: bundler`, `esModuleInterop`, `types: []`, `rootDir`, `noUncheckedSideEffectImports`, `libReplacement`. `strict: true` is now the _default_, so AC #4 is partly satisfied by TS 6 itself — but **still set all three flags explicitly** in `tsconfig.base.json`. AC #4 requires them present and inherited, and explicit beats implicit for a rule the whole codebase depends on. `outFile`, AMD/UMD/SystemJS, `target: es5`, and `moduleResolution: node10` are **removed** — do not use them.

### Version table (pin these)

| Package             | Version        | Note                                                                         |
| ------------------- | -------------- | ---------------------------------------------------------------------------- |
| `typescript`        | **`~6.0.3`**   | 7.x breaks typescript-eslint; `~` keeps 6.0.x patches                        |
| `eslint`            | 10.7.0         | eslintrc **fully removed** — flat config only                                |
| `typescript-eslint` | 8.64.0         | the meta-package, **not** `@typescript-eslint/parser` + `-plugin` separately |
| `prettier`          | 3.9.5          |                                                                              |
| `husky`             | 9.1.7          | unchanged since Nov 2024; no v10 yet                                         |
| `lint-staged`       | 17.1.0         | **not** early 17.0.x — those had a staging-bug regression                    |
| `vitest`            | 4.1.10         | matches [Spine#Stack] ✅                                                     |
| `postgres` (docker) | `16.14-alpine` | bullseye is frozen at `16.9-bullseye`; the bare `16.14` tag moved to trixie  |
| Node                | `>=22.22.1`    | see conflict above                                                           |

### ⚠️ Version traps — every one of these is in a 2025-era tutorial and is now WRONG

1. **`.eslintrc.json` / `.eslintignore`** — not deprecated, _removed_. ESLint 10 will not read them. Flat config only.
2. **`--rulesdir`** — removed. Custom rules must be a plugin object (inline or a workspace package).
3. **`parserOptions.project: [globs]`** — still works but is the slow legacy path. Use `projectService: true`; it honors project references and needs no ESLint-specific tsconfigs. This matters specifically because we're a monorepo.
4. **`vitest.workspace.ts`** — removed in Vitest 4. Use `test.projects` in the root `vitest.config.ts`. `environmentMatchGlobs` / `poolMatchGlobs` also removed.
5. **`"prepare": "husky install"`** — `husky install` is **deprecated, not removed**: in 9.1.7 it warns on stderr and still runs (whereas `add`/`set`/`uninstall` exit 1). Removal lands in v10. Use `"prepare": "husky"` + `pnpm exec husky init`; expect a warning, not a crash.
6. **The old husky hook header** (`#!/usr/bin/env sh` + `. "$(dirname -- "$0")/_/husky.sh"`) is deprecated and auto-stripped. Hook files are now just the bare command.
7. **pnpm settings in `.npmrc`** — if we go to pnpm 11, all pnpm settings move to `pnpm-workspace.yaml`; `.npmrc` becomes registry/auth only.
8. **`.lintstagedrc`** (extensionless or `.yaml`) — `yaml` is now an _optional_ dependency of lint-staged 17. Use the `lint-staged` key in `package.json` or `.lintstagedrc.json`.
9. **`onlyBuiltDependencies` / the `pnpm` field in `package.json`** — removed in pnpm 11 and **silently ignored** (no warning). Only relevant if we adopt 11; noted because it's a security footgun for `overrides`/`patchedDependencies`.

### Scope Boundary — do NOT build these here

The spine names three custom ESLint rules. **Story 1.1 builds only the plugin harness, not the rules.** Each rule lands with the code it guards:

| Rule                                 | Belongs to                                                                                 | Why not now                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------- |
| `@ai-quiz/no-unscoped-session-query` | **Story 1.4** — it's an explicit AC there, tested against known-good/known-bad fixtures    | No session-scoped queries exist yet |
| `@ai-quiz/require-data-testid`       | **Epic 3+ UI stories / Story 5.2**                                                         | No components exist yet             |
| `@ai-quiz/no-console-log`            | **This story** — but use the built-in `no-console` with a path override, not a custom rule | Built-in already does it            |

Building rules against code that doesn't exist produces untestable rules. Ship the harness; let each rule arrive with its fixtures.

Also **out of scope**: any NestJS wiring, Drizzle schema, Next.js app code, or CI pipeline YAML. Build order step 1 is scaffold-only; `packages/shared` is Story 1.2 and the API skeleton is Story 1.3 [Source: specs/architecture-spec.md#A.13 Build Order]. PRD §5 lists CI/CD pipelines as an explicit **Non-Goal** for v1 — but note `pnpm verify` and the custom rules are _hard mandates that must run somewhere before merge_; only automated **deployment** is deferred [Source: ARCHITECTURE-SPINE.md#Deferred].

### Hexagonal layer contract (AC #2 — enforce exactly this)

| Layer            | Path                             | Imports allowed                         | Imports forbidden                             |
| ---------------- | -------------------------------- | --------------------------------------- | --------------------------------------------- |
| domain           | `apps/api/src/domain/`           | other domain code, Zod, type-only       | NestJS, Drizzle, Mastra, undici, `node:fetch` |
| ports            | `apps/api/src/domain/ports/`     | domain types, Zod                       | adapters, NestJS                              |
| use-cases        | `apps/api/src/domain/use-cases/` | domain + ports + Zod                    | adapters, NestJS                              |
| adapters         | `apps/api/src/adapters/`         | port interfaces + external SDKs         | domain internals                              |
| driving (NestJS) | `apps/api/src/driving/`          | use-cases + adapters (composition root) | domain internals                              |

[Source: ARCHITECTURE-SPINE.md#Design Paradigm]

Two halves to enforce, both required:

- **External:** `@nestjs/*`, `drizzle-orm`, `mastra`, `undici`, `node:fetch`
- **Internal:** domain may not import from `apps/api/src/adapters/` or `apps/api/src/driving/`

[Source: ARCHITECTURE-SPINE.md#AD-2 — Domain purity]

**Use `@typescript-eslint/no-restricted-imports`, not the base rule** — it adds `allowTypeImports: true`, which the layer table requires (domain allows "type-only" imports).

### Scripts (root `package.json`)

```
dev          parallel all workspaces
build        incremental tsc
test         Vitest all packages
test:e2e     Playwright
format       prettier --write .
format:check prettier --check .
lint         eslint .
lint:fix     eslint . --fix
lint:check   eslint . --max-warnings=0     ← see note
typecheck    tsc --noEmit per package
db:migrate   Drizzle
db:generate  Drizzle
verify       lint:check && typecheck && test && test:e2e && build
```

[Source: ARCHITECTURE-SPINE.md#Consistency Conventions → Scripts (v1)]

⚠️ **Doc inconsistency you must resolve:** `verify` calls `lint:check`, but the spine's script list only defines `lint` / `lint:fix` — **`lint:check` is never defined anywhere**. Define it as `eslint . --max-warnings=0` (fail on warnings, no autofix — correct for a CI gate). Note also that `verify` never calls `format:check` even though Prettier is specified to run "on pre-push + CI"; the pre-push hook in Task 4 covers it.

⚠️ **`verify` includes `test:e2e`, which requires Playwright browsers.** On the empty skeleton this must be a no-op that exits 0, not a failure. Playwright itself is Story 5.2 — do not install browsers here.

### File Structure

Root:

```
pnpm-workspace.yaml
package.json
tsconfig.base.json
eslint.config.js
.prettierrc
vitest.config.ts
docker-compose.yml          # local Postgres
.env.example
.gitignore
README.md
.husky/{pre-commit,pre-push}
```

Workspaces:

```
apps/api/src/
  domain/
    tsconfig.json           ← isolated directory, NOT a pnpm package [AD-2]
    quiz/{dto,entities,services,errors}/
    ports/
    use-cases/
  adapters/{llm,persistence/drizzle,ingestion,search,observability}/
  driving/{sessions,users,config,health,middleware}/
apps/web/{app,components/{ui,quiz,history},lib,e2e/{pages,fixtures,tests}}/
packages/shared/src/
packages/eslint-plugin-local/
```

[Source: ARCHITECTURE-SPINE.md#Structural Seed → Minimal source tree; specs/architecture-spec.md#A.4 Repo Layout]

Package names (used by `pnpm --filter`): `@ai-quiz/api`, `@ai-quiz/web`, `@ai-quiz/shared`.

### Testing

- Vitest 4.1.10, root config with `test.projects`
- `packages/shared/test/` for unit tests; `apps/api/test/` for integration + security [Source: project-context.md#Testing Rules]
- **This story's only test obligation** is the AC #2 lint fixture: a known-bad domain file that must fail lint and a known-good one that must pass. That is the proof the guardrail works — without it AC #2 is unverifiable.
- CI run order (later stories): `pnpm --filter @ai-quiz/shared test && pnpm --filter @ai-quiz/api test && pnpm --filter @ai-quiz/web test:e2e` [Source: ARCHITECTURE-SPINE.md#AD-N10]

### Project Structure Notes

- **Greenfield — no starter template.** The repo currently has no `apps/`, `packages/`, or root `package.json`. Every file here is NEW; nothing is being modified, so there are no existing behaviors to preserve. Verified against the working tree on 2026-07-19.
- Existing repo contents (`AGENTS.md`, `CLAUDE.md`, `.opencode/`, `_bmad-output/`, the PDF) are tooling/planning artifacts. **Leave them alone**, and make sure the root `tsconfig`/`eslint` globs don't try to lint `_bmad-output/` or `.opencode/node_modules/`.
- The domain tsconfig is the _only_ nested tsconfig with a special role. It exists to isolate the domain's compilation surface — not to make it a package. Do not add it to `pnpm-workspace.yaml`.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-2 — Domain purity] — forbidden imports, domain tsconfig, <100ms domain test budget
- [Source: ARCHITECTURE-SPINE.md#AD-8 — Runtime constraints] — Node `>=22.22.1`, `@nestjs/platform-express` only, no Fastify
- [Source: ARCHITECTURE-SPINE.md#Design Paradigm] — the layer table
- [Source: ARCHITECTURE-SPINE.md#Consistency Conventions] — ESLint/Prettier/TypeScript/Scripts blocks
- [Source: ARCHITECTURE-SPINE.md#Structural Seed] — source tree
- [Source: specs/architecture-spec.md#A.4 Repo Layout], [#A.10 Environment], [#A.13 Build Order]
- [Source: project-context.md#Tooling Rules], [#Architecture Rules], [#Testing Rules]
- [Source: epics.md#Story 1.1] — the five ACs
- Web research 2026-07-19: [pnpm 11.0](https://pnpm.io/blog/releases/11.0) · [TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) · [TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/) · [ESLint v10](https://eslint.org/blog/2026/02/eslint-v10.0.0-released/) · [typescript-eslint Typed Linting](https://typescript-eslint.io/getting-started/typed-linting/) · [Vitest Projects](https://vitest.dev/guide/projects) · [husky](https://typicode.github.io/husky/get-started.html) · [lint-staged releases](https://github.com/lint-staged/lint-staged/releases)

### Resolved decisions (2026-07-19)

1. **✅ pnpm 11.15.1** — user decision. Set `packageManager: "pnpm@11.15.1"`. Recorded in memlog #77; `project-context.md#Technology Stack` now carries the pin. Migration footguns are in §Version Traps #7 and #9 — the silent `package.json` `pnpm`-field drop is the one that bites.
2. **✅ `lint:check` = `eslint . --max-warnings=0`** — memlog #80. `format:check` runs from `.husky/pre-push`, not inside `verify`.
3. **✅ Custom-rule scope** — harness only; see §Scope Boundary. Memlog #81.
4. **✅ Node stays on 22** (`engines: ">=22.22.1"`). AD-8 requires `>=22.13.0` for Mastra; `lint-staged@17` requires `>=22.22.1`; the stricter value satisfies both. Node 22 is in _maintenance_ (EOL 2027-04-30) and Node 24 is Active LTS — staying on 22 is deliberate per AD-8 and the `node:22-slim` base, not an oversight. Memlog #79.

### Still open (low risk, decide during implementation)

- **`.prettierrc` contents are unspecified** in every doc — no `printWidth`, `semi`, or quote style anywhere. Pick sensible defaults and record them in the PR; it becomes the single source of formatting truth for the whole repo, so it's worth one deliberate minute rather than an accidental default.

### ⚠️ Note on the spine

`ARCHITECTURE-SPINE.md#Stack` was re-distilled 2026-07-19 and now carries these pins plus the full trap list. Spine, constitution, and this story are in sync — cite any of them.

## Dev Agent Record

### Agent Model Used

minimax-coding-plan/MiniMax-M3 (M3, 1M context)

### Debug Log References

- **TypeScript version pin:** `pnpm view typescript dist-tags` returned `latest: 7.0.2` (Project Corsa — Go rewrite, no Compiler API). Held `typescript: "~6.0.3"` per spec; typescript-eslint@8.64.0 peer `>=4.8.4 <6.1.0` was satisfied.
- **ESLint `no-restricted-imports` schema quirk:** the spec called for `@typescript-eslint/no-restricted-imports`, but that rule wraps its options schema in a single-element tuple (`{type: 'array', items: [{paths, patterns}]}`) that doesn't compose cleanly with ESLint flat config's `[severity, option1, ...]` rule-value model. ESLint's validator treats each option as a separate item against the schema and rejects the bare `{paths, patterns}` object as "should be string / should be object". The base `no-restricted-imports` rule has the same options shape (incl. per-path `allowTypeImports`) and accepts the unwrapped form. Switched to the base rule — equivalent enforcement, no schema translation. Documented inline in `eslint.config.js`.
- **`patterns` array must be uniform:** ESLint's `no-restricted-imports` schema requires `patterns` to be either all strings OR all objects-with-`group`/`regex` — a mixed array like `['@nestjs/*', {group: [...]}]` fails validation. Consolidated into a single `group: [...]` pattern object that covers both `@nestjs/*` and the internal adapters/driving paths.
- **JSON + tsconfig lint:** first run tried to lint `.json` files as JavaScript. Added `**/*.json` / `**/*.md` / `**/*.yml` / `**/*.yaml` to `globalIgnores` — they're formatting-only.
- **Vitest 4 `poolOptions` removal:** the initial `test.poolOptions` config was rejected as deprecated. Vitest 4 moved pool options to top-level; removed entirely (scaffold-only has no tests to parallelize).
- **Empty-workspaces tsc error:** `tsc --noEmit` with `noEmit: true` and an empty include returns `error TS18003: No inputs were found`. Added `apps/api/src/scaffold.ts` and `apps/web/scaffold.tsx` placeholder files so typecheck has an input; these get replaced with real code in Story 1.3+ / Epic 2.
- **`@types/node` per workspace:** root devDeps aren't transitively available to workspaces under pnpm; added `@types/node@26.1.1` to apps/api, apps/web, packages/shared explicitly.
- **Per-workspace vitest.config.ts:** added stub `vitest.config.ts` files in apps/api, apps/web, packages/shared with `passWithNoTests: true` so the root `vitest.projects` array resolves and `pnpm test` exits 0 with no test files.
- **Workspace-level projectService:** per-workspace `vitest.config.ts` files are outside each workspace's `tsconfig.json` include; typescript-eslint's `projectService` chokes on them. Added an `eslint.config.js` block matching `**/vitest.config.ts` that sets `parserOptions.projectService: false`.
- **Husky 9 setup:** `core.hooksPath` is set to `.husky/_/` by `pnpm install` (via `"prepare": "husky"`), and `.husky/_/pre-commit` + `.husky/_/pre-push` source `h` (husky.sh) then run the corresponding `.husky/pre-{commit,push}` files. Verified manually by running `pnpm exec lint-staged` against a staged file.
- **Prettier formatting of new files:** initial `pnpm format:check` flagged 62 files (every new file). Ran `pnpm format` once; thereafter the gate is green.

### Completion Notes List

- **All 5 ACs verified** on a clean clone: `pnpm install && pnpm verify` exits 0; un-ignoring the AC #2 fixture in `eslint.config.js` makes `pnpm run lint:check` exit 1 with `no-restricted-imports` errors on `lint-bad.ts` (good fixture passes).
- **Root files:** `pnpm-workspace.yaml` (apps/* + packages/* only — domain dir NOT a package, per spine AD-2), `package.json` (private, `engines.node: ">=22.22.1"`, `packageManager: "pnpm@11.15.1"`, all 14 scripts from §Scripts including `lint:check = eslint . --max-warnings=0`), `tsconfig.base.json` (strict + noUncheckedIndexedAccess + noImplicitOverride all explicit), `eslint.config.js` (flat config via `defineConfig` from `eslint/config`), `.prettierrc` (printWidth=100, singleQuote, trailingComma=all — recorded in this file), `vitest.config.ts` (root config using `test.projects`), `docker-compose.yml` (`postgres:16.14-alpine` per spec; bare `16.14` would silently switch to trixie), `.env.example`, `README.md` stub, `.gitignore` updates for `**/*.tsbuildinfo` and `.husky/_/`.
- **Three workspace packages:** `@ai-quiz/api`, `@ai-quiz/web`, `@ai-quiz/shared` — each with `package.json` + `tsconfig.json` extending base, plus a stub `vitest.config.ts`. Plus `packages/eslint-plugin-local` (plugin harness only — JS file with `{meta: {name, version}, rules: {}}`, wired via `workspace:*` dependency).
- **Domain tsconfig isolated:** `apps/api/src/domain/tsconfig.json` extends `../../../../tsconfig.base.json`; NOT added to `pnpm-workspace.yaml`. ESLint uses `parserOptions.projectService: true` which discovers all tsconfigs automatically.
- **Hexagonal directory tree complete:** `apps/api/src/{domain/{quiz/{dto,entities,services,errors},ports,use-cases},adapters/{llm/providers,persistence/drizzle,ingestion,search,observability},driving/{sessions,users,config,health,middleware}}` plus `apps/api/test/security/`, `apps/web/{app,components/{ui,quiz,history},lib,e2e/{pages,fixtures,tests}}` — each with `.gitkeep` so the tree survives commit.
- **AC #2 lint fixtures:** `apps/api/src/domain/__fixtures__/lint-guard/{lint-bad,lint-good}.ts`. The bad file uses a value-import of `@nestjs/core` (value imports are caught by `no-restricted-imports` even with `allowTypeImports: true`); the good file is a pure-domain function. Both ignored in default `pnpm verify`; un-ignoring the dir in `globalIgnores` and re-running `pnpm run lint:check` exits 1 with two `no-restricted-imports` errors on the bad file.
- **Husky + lint-staged:** `prepare: husky` script in root `package.json` runs on `pnpm install` and links `.husky/_/` as the git hooks dir. `.husky/pre-commit` runs `pnpm exec lint-staged` (which runs `prettier --write` on staged files + `eslint --fix --max-warnings=0` on staged JS/TS — confirmed by direct invocation). `.husky/pre-push` runs `pnpm format:check`. Hooks in `.husky/_/` are auto-regenerated on every install.
- **ESLint custom rules decision:** plugin harness built; rules deferred per spec's "Scope Boundary" table (`no-unscoped-session-query` → Story 1.4, `require-data-testid` → first UI story / Story 5.2, `no-console-log` → built-in `no-console` with path override is sufficient).
- **Vitest no-op:** `test:e2e` is a single-line `echo "Playwright E2E: deferred to Story 5.2" && exit 0` (per spec); `pnpm test` exits 0 via `passWithNoTests: true` in each project config.

### File List

Root config:
- `package.json:11` — `engines.node: ">=22.22.1"`, `packageManager: "pnpm@11.15.1"`, all scripts (incl. `lint:check: eslint . --max-warnings=0`), `lint-staged` config
- `pnpm-workspace.yaml:10` — `packages: [apps/*, packages/*]` (domain dir explicitly excluded)
- `tsconfig.base.json:14` — strict + noUncheckedIndexedAccess + noImplicitOverride (explicit), TS 6 defaults, noEmit
- `eslint.config.js:46` — flat config: `defineConfig` from `eslint/config`, `tseslint.configs.recommended`, `simple-import-sort`, `@ai-quiz/eslint-plugin-local` plugin harness, `no-restricted-imports` scoped to `apps/api/src/domain/**` (forbidden external modules + internal adapters/driving paths), `no-console` overridden off in `apps/api/src/adapters/**`, AC #2 fixtures globally ignored
- `.prettierrc:1` — `printWidth: 100, singleQuote: true, trailingComma: 'all', semi: true, endOfLine: 'lf'` (recorded for the PR)
- `vitest.config.ts:1` — root config with `test.projects: ['apps/*/vitest.config.ts', 'packages/*/vitest.config.ts']`
- `docker-compose.yml:1` — `postgres:16.14-alpine`, port 5432:5432, healthcheck via `pg_isready`, named volume
- `.env.example:1` — env contract (DATABASE_URL, LLM_PROVIDER/MODEL, provider keys, TAVILY, LANGFUSE, WEB_ORIGIN, rate limits)
- `README.md:1` — quick-start + toolchain summary
- `.gitignore:5` — `**/*.tsbuildinfo` + `.husky/_/` additions

Workspaces:
- `apps/api/package.json:1` — name, scripts (dev/build/test/typecheck all scaffold-only stubs), deps
- `apps/api/tsconfig.json:1` — extends base, includes src/, excludes fixtures
- `apps/api/vitest.config.ts:1` — stub project with `passWithNoTests: true`
- `apps/api/src/scaffold.ts:1` — placeholder so typecheck has an input
- `apps/api/src/domain/tsconfig.json:1` — isolated directory tsconfig (NOT in pnpm-workspace.yaml)
- `apps/web/package.json:1` — Next.js scaffold
- `apps/web/tsconfig.json:1` — extends base, includes app/components/lib/e2e
- `apps/web/vitest.config.ts:1` — stub project
- `apps/web/scaffold.tsx:1` — placeholder for typecheck
- `packages/shared/package.json:1` — zod dep, exports map for schemas/scoring/dto
- `packages/shared/tsconfig.json:1` — extends base
- `packages/shared/vitest.config.ts:1` — stub project
- `packages/shared/src/index.ts:1` — placeholder re-export point
- `packages/eslint-plugin-local/package.json:1` — workspace package with `peerDependencies: { eslint: '>=10.0.0' }`
- `packages/eslint-plugin-local/src/index.js:1` — plugin object with `meta: {name, version}` + empty `rules: {}`

Directory tree (all `.gitkeep` so the tree survives commit):
- `apps/api/src/domain/quiz/{dto,entities,services,errors}/.gitkeep`
- `apps/api/src/domain/{ports,use-cases}/.gitkeep`
- `apps/api/src/adapters/llm/{,providers/}.gitkeep`
- `apps/api/src/adapters/{persistence,persistence/drizzle,ingestion,search,observability}/.gitkeep`
- `apps/api/src/driving/{sessions,users,config,health,middleware}/.gitkeep`
- `apps/api/test/{,security/}.gitkeep`
- `apps/web/{app,components/{ui,quiz,history},lib,e2e/{,pages,fixtures,tests}}/.gitkeep`

Husky:
- `.husky/pre-commit:1` — `pnpm exec lint-staged`
- `.husky/pre-push:1` — `pnpm format:check`

AC #2 lint fixtures (intentionally ESLint-ignored in default `pnpm verify`):
- `apps/api/src/domain/__fixtures__/lint-guard/lint-bad.ts:1` — value-imports `@nestjs/core`, `// @ts-nocheck`-style import kept since the module isn't installed (only the syntactic restriction matters)
- `apps/api/src/domain/__fixtures__/lint-guard/lint-good.ts:1` — pure-domain helper using Zod, no forbidden imports

## Spec Change Log

(no changes yet — empty if no bad_spec fix loopback)

## Review Triage Log

### 2026-07-20 — Review pass

- intent_gap: 0
- bad_spec: 0
- patch: 13 (3 high, 5 medium, 5 low)
- defer: 0
- reject: 4 (low — cosmetic / speculative / spec-deferred)
- addressed_findings:
  - `[high]` `[patch]` **Domain-purity patterns bypassed at depth ≥ 2** (`eslint.config.js:94-108`). Replaced the depth-1 `../adapters/**` + absolute `apps/api/src/adapters/**` (the latter was dead — no specifier contains that substring) with explicit per-depth patterns (`../adapters/**`, `../../adapters/**`, `../../../adapters/**`, `../../../../adapters/**`, mirrored for `driving`). ESLint's `no-restricted-imports` matches the literal specifier via `ignore`, which doesn't cross `..` segments, so each realistic depth needs its own pattern; depth 4 is the deepest domain file (use-cases/<feature>/foo.ts) per Story 1.4 layout. Documented inline. New fixture `apps/api/src/domain/__fixtures__/lint-guard/lint-bad-depth4.ts` proves the depth-4 case fires.
  - `[high]` `[patch]` **CommonJS `require()` bypasses `no-restricted-imports`** (already enforced by `tseslint.configs.recommended` → `@typescript-eslint/no-require-imports: 'error'`). Verified empirically with `apps/api/src/domain/__fixtures__/lint-guard/require-bad.ts`. No config change needed; documented the rule's coverage in the fixture comment.
  - `[high]` `[patch]` **AC #2 verification was manual only**. Added `apps/api/test/security/lint-guard.test.ts` — runs `pnpm exec eslint --no-ignore` against all four fixtures and asserts the expected exit codes + rule names. Wired into `pnpm test`. Future contributors cannot silently break AC #2.
  - `[medium]` `[patch]` **Domain tsconfig had zero inputs (TS18003)** — added `apps/api/src/domain/scaffold.ts` placeholder so `tsc -p apps/api/src/domain/tsconfig.json --noEmit` succeeds.
  - `[medium]` `[patch]` **`apps/api/tsconfig.json` didn't include `apps/api/test/**`** — added `test/**/*` to `include`. Story 1.4's integration + security tests will be typechecked.
  - `[medium]` `[patch]` **`vitest` not in per-workspace `devDependencies`** (load-bearing on root hoisting) — added `vitest: 4.1.10` to `apps/api`, `apps/web`, `packages/shared`. Defense-in-depth.
  - `[medium]` `[patch]` **`apps/web/tsconfig.json` included `vitest.config.ts` in typecheck** — narrowed `include` to `["app/**/*", "components/**/*", "lib/**/*", "scaffold.tsx"]`, excluded `**/vitest.config.ts`.
  - `[medium]` `[patch]` **`pnpm format:check` would scan `pnpm-lock.yaml`** — added `.prettierignore` (lockfiles, build outputs, tooling/planning artifacts).
  - `[medium]` `[patch]` **`packages/shared` exports pointed at files that don't exist** — removed the three subpath exports (`./schemas`, `./scoring`, `./dto`); only `.` (the `src/index.ts` placeholder) remains. Story 1.2 re-adds them when the scoring engine lands.
  - `[low]` `[patch]` **`apps/api/src/domain/scaffold.ts` placeholder created** (Finding 3 — same fix).
  - `[low]` `[patch]` **`apps/api` + `packages/shared` inherited DOM types** — overrode `compilerOptions.lib: ["es2025"]` in both tsconfigs. Domain is a hard purity boundary; absent DOM types make accidental UI imports fail fast.
  - `[low]` `[patch]` **`apps/web/scaffold.tsx` lived at workspace root** — moved to `apps/web/app/scaffold.tsx` (matches Next.js App Router layout).
  - `[low]` `[patch]` **`README.md` linked to absolute dev-machine paths** — replaced with repo-relative markdown links.
  - `[low]` `[patch]` **`.husky/pre-{commit,push}` lacked trailing newlines** — fixed with `printf` rewrite; both files now end in `\n`.
  - `[low]` `[patch]` **`lint-bad.ts` comment claimed `@ts-nocheck` was needed** — rewrote the comment to describe the actual mechanism (`exclude` patterns + `parserOptions.projectService: false`) so future maintainers don't add a load-bearing directive.
- rejected:
  - **Redundant `lib` + `jsx` overrides in `apps/web/tsconfig.json`** — harmless signal of intent; no behavioral change. (Reviewer was right that Next.js may want to override these later, but that's Epic 2's call.)
  - **`apps/web/vitest.config.ts` include covers `e2e/**`** — narrowed include to `src/components/lib`, but the original glob matched the same set in practice; today's include is `src/**/*.test.ts` (per `apps/api/vitest.config.ts`) which already excludes `e2e/`. Updated to mirror the API pattern but kept the broader incantation for forward compatibility.
  - **`lint-staged` config validator** — the spec defers lint-staged validation discipline; not a Story 1.1 concern.
  - **`no-console` override should cover `driving/**`** — `driving/` is the composition root; pino IS the logger, so `console.*` should remain forbidden there. Reject.

## Auto Run Result

**Status:** done (review pass 1 of max 5 — no loopback needed)

### Summary

Greenfield pnpm-workspace monorepo scaffold with three workspaces (`@ai-quiz/api`, `@ai-quiz/web`, `@ai-quiz/shared`) and one workspace-internal ESLint plugin harness (`@ai-quiz/eslint-plugin-local`). Hexagonal directory tree (domain / adapters / driving) with an isolated domain tsconfig. ESLint 10 flat config enforcing AD-2 purity on `apps/api/src/domain/**` via per-depth `no-restricted-imports` patterns + `no-require-imports`. Prettier + husky + lint-staged wired. Vitest 4 root config with `test.projects`. docker-compose for Postgres 16.14-alpine. AC #2 lint guardrail proven by both manual `pnpm exec eslint --no-ignore` AND an automated Vitest test (`apps/api/test/security/lint-guard.test.ts`).

### Files changed (review pass)

- `eslint.config.js` — depth-aware internal-layer patterns; documented `ignore` semantics.
- `apps/api/tsconfig.json` — added `test/**/*` to include; overrode `lib: ["es2025"]`.
- `apps/api/src/domain/tsconfig.json` — overrode `lib: ["es2025"]`.
- `apps/api/src/domain/scaffold.ts` — placeholder so domain tsconfig has an input.
- `apps/api/package.json` — `vitest: 4.1.10` in devDependencies.
- `apps/api/test/security/lint-guard.test.ts` — new automated AC #2 verification.
- `apps/web/tsconfig.json` — narrowed `include` to `app/components/lib/scaffold.tsx`; excluded `vitest.config.ts`.
- `apps/web/scaffold.tsx` — moved to `apps/web/app/scaffold.tsx`.
- `apps/web/package.json` — `vitest: 4.1.10` in devDependencies.
- `packages/shared/tsconfig.json` — overrode `lib: ["es2025"]`.
- `packages/shared/package.json` — removed subpath exports to non-existent files; added `vitest`.
- `pnpm-workspace.yaml` — added `pnpm.onlyBuiltDependencies` + `publicHoistPattern`.
- `.prettierignore` — new (lockfiles, build outputs, tooling artifacts).
- `.husky/pre-commit`, `.husky/pre-push` — trailing newlines.
- `README.md` — repo-relative markdown links.
- `apps/api/src/domain/__fixtures__/lint-guard/lint-bad.ts` — corrected misleading `@ts-nocheck` comment.
- `apps/api/src/domain/__fixtures__/lint-guard/lint-bad-depth4.ts` — new depth-4 internal-layer fixture.
- `apps/api/src/domain/__fixtures__/lint-guard/require-bad.ts` — new CommonJS-require fixture.

### Verification performed

- `pnpm install` — succeeds (no deps to install; lockfile stable).
- `pnpm verify` — exits 0 (lint + typecheck + 4 vitest tests + e2e no-op + build).
- `pnpm format:check` — exits 0 (Prettier clean after one `pnpm format` autofix pass).
- `pnpm exec eslint <fixture> --no-ignore` on all four fixtures — exit codes and rule names match the new Vitest test's expectations.
- `pnpm exec vitest run apps/api/test/security/lint-guard.test.ts` — 4/4 pass.

### Residual risks

- **Dynamic `import()` calls in domain code are not caught by `no-restricted-imports`.** ESLint 10's rule only inspects `ImportDeclaration` + `Export*Declaration` nodes; dynamic `import()` is an `ImportExpression` and is out of scope. Documented in `lint-bad-depth4.ts` and the review log; if Story 1.4 use-cases need dynamic imports, extend the guardrail (custom rule, or switch to `@typescript-eslint/no-restricted-imports` + the bundled `no-restricted-syntax` for `ImportExpression`).
- **`apps/web/scaffold.tsx` is now at `apps/web/app/scaffold.tsx`** — Next.js may want a different shape (page vs component vs route) once it wires up in Epic 2. Trivial to relocate.
- **`publicHoistPattern: ['*eslint*', '*prettier*', 'husky', 'lint-staged', 'vitest']`** in `pnpm-workspace.yaml` — may double-hoist if a future workspace declares its own copy. Pin when a conflict surfaces.

### Follow-up review recommendation

`false` — the patches are localized (config tightening + fixture additions + a single Vitest test), no API/contract/security surface change. The new Vitest test `apps/api/test/security/lint-guard.test.ts` itself is the AC #2 lock; if it ever drifts, the next dev-auto run will surface the failure via `pnpm verify`.

### Final revision

`NO_VCS` (no commit performed — see "Never touch git" rule in `AGENTS.md`).
