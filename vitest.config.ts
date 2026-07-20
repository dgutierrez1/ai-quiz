// Vitest 4 root config — see story 1.1 + spine Consistency Conventions.
// Vitest 4 removed vitest.workspace.ts in favor of `test.projects` in the root
// config. For Story 1.1 (scaffold-only) all workspaces are empty and there are
// no tests yet — `passWithNoTests: true` lets `pnpm verify` exit 0.
//
// Story 1.2 (packages/shared) adds the first project-level test config — it
// lives in `packages/shared/vitest.config.ts` and is referenced from the
// `test.projects` array below at that time.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Scaffold-only: no tests exist yet, and `pnpm verify` must stay green.
    // Once tests land in Story 1.2, this flag becomes a no-op.
    passWithNoTests: true,
    projects: ['apps/*/vitest.config.ts', 'packages/*/vitest.config.ts'],
  },
});
