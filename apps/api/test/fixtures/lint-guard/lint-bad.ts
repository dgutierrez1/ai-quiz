// AC #2 — KNOWN-BAD domain fixture.
//
// This file IMPORTS `@nestjs/core` from inside the domain layer. It MUST be
// flagged by `no-restricted-imports` (spine AD-2) when ESLint is run on it.
//
// Why this file works despite the unresolved import: `@nestjs/core` is NOT a
// workspace dependency in Story 1.1 (Drizzle/NestJS wiring lands in Story 1.3).
// The file is excluded from every tsconfig include
// (`apps/api/tsconfig.json` `test/fixtures/lint-guard/**`) and ESLint sets
// `parserOptions.projectService: false` for this directory — so `tsc` never
// sees the unresolved import. ESLint's `no-restricted-imports` is a syntactic
// check on the import specifier and fires regardless of resolution status.
//
// To verify the guardrail:
//   1. Pass `--no-ignore` when invoking eslint (the directory is in the
//      default `globalIgnores` so AC #2 doesn't fail the verify gate).
//   2. Run `pnpm exec eslint apps/api/test/fixtures/lint-guard/lint-bad.ts --no-ignore`.
//   3. Expected: errors — "domain MUST NOT import from @nestjs/* (spine AD-2)".
//   4. Run `pnpm exec eslint apps/api/test/fixtures/lint-guard/lint-good.ts --no-ignore`.
//   5. Expected: exit 0 (no errors).

// The import statement must remain a VALUE import (not type-only) for the
// `no-restricted-imports` rule to fire — see the AC #2 guardrail's
// `allowTypeImports: true` on each forbidden path, which permits
// `import type` but blocks `import { value }`. The marker constant is
// exported so the file is not flagged for being empty.
import { Module } from '@nestjs/core';

export const _lintBadMarker = 'lint-bad: imports @nestjs/core from inside the domain';
export const _referencedNestModule = Module;
