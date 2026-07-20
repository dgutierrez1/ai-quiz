// packages/shared/vitest.config.ts — Story 1.2 scoring engine.
//
// Coverage gate is scoped to `src/scoring.ts` (the pure module under test).
// Threshold is the floor from spine AD-N10 / AC #10 — 95% on every metric,
// targeting 100% for a pure module with no I/O. Schemas live next door but
// are not gated here; they are exercised through the scoring tests via the
// `PositionSetSchema` validation path.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      include: ['src/scoring.ts'],
      reporter: ['text', 'text-summary', 'json-summary'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
