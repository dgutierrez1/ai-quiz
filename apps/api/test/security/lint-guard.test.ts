// Story 1.1 — AC #2 lint guardrail test.
//
// This is the AUTOMATED version of the manual AC #2 verification. It runs
// `eslint --no-ignore` against the lint-guard fixture pair and asserts:
//   - lint-bad.ts fails with a `no-restricted-imports` error (external module)
//   - lint-bad-depth4.ts fails with a `no-restricted-imports` error (depth-4 internal-layer)
//   - require-bad.ts fails with a `no-require-imports` error
//   - lint-good.ts passes
//
// If any of these exit-codes or rule names flip, AC #2 is silently broken and
// this test fails the verify gate. Run from the repo root:
//   pnpm --filter @ai-quiz/api test
// Or directly:
//   pnpm exec vitest run apps/api/test/security/lint-guard.test.ts

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// apps/api/test/security/lint-guard.test.ts → repo root is 4 levels up.
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
const FIXTURE_DIR = path.join(ROOT, 'apps/api/test/fixtures/lint-guard');

function runEslint(files: string[]): { code: number; stdout: string } {
  try {
    const stdout = execFileSync(
      'pnpm',
      ['exec', 'eslint', '--no-ignore', '--max-warnings=0', ...files],
      { cwd: ROOT, encoding: 'utf8' },
    );
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { status: number | null; stdout: string };
    return { code: e.status ?? 1, stdout: e.stdout ?? '' };
  }
}

describe('Story 1.1 — AC #2 lint guardrail', () => {
  it('lint-bad.ts (external module @nestjs/core) is flagged by no-restricted-imports', () => {
    const { code, stdout } = runEslint([`${FIXTURE_DIR}/lint-bad.ts`]);
    expect(code).toBe(1);
    expect(stdout).toMatch(/no-restricted-imports/);
    expect(stdout).toMatch(/@nestjs\/core/);
  });

  it('lint-bad-depth4.ts (depth-4 internal-layer) is flagged by no-restricted-imports', () => {
    const { code, stdout } = runEslint([`${FIXTURE_DIR}/lint-bad-depth4.ts`]);
    expect(code).toBe(1);
    expect(stdout).toMatch(/no-restricted-imports/);
    expect(stdout).toMatch(/adapters or driving layer/);
  });

  it('require-bad.ts (CommonJS require) is flagged by no-require-imports', () => {
    const { code, stdout } = runEslint([`${FIXTURE_DIR}/require-bad.ts`]);
    expect(code).toBe(1);
    expect(stdout).toMatch(/no-require-imports/);
  });

  it('lint-good.ts (compliant domain helper) passes', () => {
    const { code, stdout } = runEslint([`${FIXTURE_DIR}/lint-good.ts`]);
    expect(code).toBe(0);
    expect(stdout).toBe('');
  });
});
