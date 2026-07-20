// AC #2 fixture — bad (require() bypass attempt). Verifies no-require-imports
// fires inside the domain.
//
// This file is intentionally ESLint-ignored by default via the globalIgnores
// entry in `eslint.config.js`. To prove the rule fires:
//   pnpm exec eslint apps/api/src/domain/__fixtures__/lint-guard/require-bad.ts --no-ignore
// Expected: exit 1 with no-require-imports error on the require() call.

const _forbidden = require('@nestjs/core');

export const value = _forbidden;
