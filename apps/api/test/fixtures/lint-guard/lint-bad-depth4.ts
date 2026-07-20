// AC #2 — KNOWN-BAD domain fixture (depth-4 internal-layer).
//
// This file IMPORTS from `apps/api/src/adapters/` from inside a depth-4 domain
// file. The relative specifier `'../../../adapters/x'` MUST be flagged by
// `no-restricted-imports` (spine AD-2 internal-layer half) when ESLint is
// run on it.
//
// To verify the guardrail:
//   pnpm exec eslint apps/api/test/fixtures/lint-guard/lint-bad-depth4.ts --no-ignore
// Expected: exit 1 with "domain MUST NOT import adapters or driving layer
// or external I/O (spine AD-2)".
//
// Why this fixture lives at depth 4: a domain file at
// `apps/api/src/domain/use-cases/sessions/foo.ts` (the natural Story 1.4 use-
// case location) imports adapters as `'../../../adapters/x'`. A pattern like
// `'../adapters/**'` (depth-1 relative) would slip past — this fixture
// locks the per-depth patterns that catch the full realistic range
// (depths 1–4 from `apps/api/src/domain/`).
//
// Note: `no-restricted-imports` in ESLint 10 only checks static `import` /
// `export ... from` statements, not dynamic `import()` calls. See Story 1.4
// to extend the guardrail to dynamic imports if use-cases need them.

import { _lintInternalLayerMarker } from '../../../adapters/llm';

export const _lintInternalLayerMarker2 = _lintInternalLayerMarker;
