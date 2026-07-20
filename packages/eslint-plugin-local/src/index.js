/**
 * @ai-quiz/eslint-plugin-local — internal ESLint plugin harness.
 *
 * Story 1.1 builds ONLY the plugin object shell. Custom rules are added in
 * later stories, each with the code it guards (no testable rule without a
 * fixture):
 *
 *   - `no-unscoped-session-query` → Story 1.4 (sessions endpoint + 4-layer ownership)
 *   - `require-data-testid`       → first UI story / Story 5.2
 *   - `no-console-log`            → DEFERRED — built-in `no-console` with a path
 *                                   override already covers this
 *
 * ESLint 10 removed `--rulesdir`, so custom rules must be a plugin object.
 * This file IS the plugin. Wired into the root `eslint.config.js`.
 */

import noTestSeamsInSrc from './rules/no-test-seams-in-src.js';
import noUnscopedSessionQuery from './rules/no-unscoped-session-query.js';

const plugin = {
  meta: {
    name: '@ai-quiz/eslint-plugin-local',
    version: '0.0.0',
  },
  rules: {
    // Story 1.4 — the dev-time half of the four-layer ownership model.
    // Postgres RLS is the runtime half; both are required (constitution rule 2).
    'no-unscoped-session-query': noUnscopedSessionQuery,
    // Keeps mock seams and NODE_ENV==='test' branches out of apps/api/src.
    // Ships with the structural split that removed the originals.
    'no-test-seams-in-src': noTestSeamsInSrc,
  },
};

export default plugin;
