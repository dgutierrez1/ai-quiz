// Per-workspace vitest stub — Story 1.1 scaffold-only.
// Story 1.4 (integration + security tests) and Story 1.2 (scoring tests) will
// flesh out the per-project include patterns and globals.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
