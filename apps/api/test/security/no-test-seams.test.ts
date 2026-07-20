// Proves `@ai-quiz/local/no-test-seams-in-src` is actually live.
//
// The rule is the permanent half of the structural split that removed the mock
// seams from the LLM and ingestion adapters. A rule that is registered but not
// wired into `eslint.config.js` — or scoped to a path that no longer matches —
// fails silently and lets the exact shape it forbids creep back in. So this
// runs the real ESLint binary against a deliberately-bad and a deliberately-
// clean fixture, mirroring `lint-guard.test.ts`'s proven approach.
//
// Run directly:
//   pnpm exec vitest run apps/api/test/security/no-test-seams.test.ts

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// apps/api/test/security/no-test-seams.test.ts → repo root is 4 levels up.
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
const FIXTURE_DIR = path.join(ROOT, 'apps/api/test/fixtures/test-seams');
const RULE = '@ai-quiz/local/no-test-seams-in-src';

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

describe('no-test-seams-in-src keeps mock scaffolding out of production source', () => {
  it('flags exported set/get/reset mock seams and NODE_ENV===test branches', () => {
    const { code, stdout } = runEslint([`${FIXTURE_DIR}/seams-bad.ts`]);
    expect(code).toBe(1);
    expect(stdout).toContain(RULE);

    // All five violations in the fixture must be caught, not just the first.
    const hits = stdout.split('\n').filter((line) => line.includes(RULE)).length;
    expect(hits).toBe(5);

    expect(stdout).toMatch(/setMockPoolResponse/);
    expect(stdout).toMatch(/getLastCallFake/);
    expect(stdout).toMatch(/resetPoolStub/);
  });

  it('leaves the clean fixture alone — NODE_ENV !== production is legitimate', () => {
    const { code, stdout } = runEslint([`${FIXTURE_DIR}/seams-good.ts`]);
    expect(stdout).not.toContain(RULE);
    expect(code).toBe(0);
  });

  it('is switched on for apps/api/src, not merely registered', () => {
    // If the rule were scoped to a stale path, the bad fixture above could
    // still fail via some other rule. Ask ESLint directly what applies to a
    // real production file.
    const stdout = execFileSync(
      'pnpm',
      ['exec', 'eslint', '--print-config', 'apps/api/src/adapters/llm/llm.adapter.ts'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    // `--print-config` normalises severities to numbers: 2 === 'error'.
    const config = JSON.parse(stdout) as { rules: Record<string, unknown> };
    expect(config.rules[RULE]).toEqual([2]);
  });
});
