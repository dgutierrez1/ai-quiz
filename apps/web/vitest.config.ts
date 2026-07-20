// Per-workspace vitest stub — Story 1.1 scaffold-only.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    passWithNoTests: true,
  },
});
