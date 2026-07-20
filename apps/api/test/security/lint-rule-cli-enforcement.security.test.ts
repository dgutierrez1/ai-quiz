// apps/api/test/security/lint-rule-cli-enforcement.security.test.ts
//
// Story 5.3 AC #11 / Task 5 — proves `@ai-quiz/no-unscoped-session-query`
// is genuinely wired into `pnpm lint:check`'s real flat config (a
// different proof than a `RuleTester` suite, which tests AST logic in
// isolation without ever invoking the real `eslint` binary against
// `eslint.config.js`). Shells out to the actual, installed `eslint`
// binary via `node:child_process` (`execFileSync`, matching the exact
// technique `apps/api/test/security/lint-guard.test.ts` already
// established for the sibling `no-restricted-imports`/`no-require-imports`
// guardrail — no new shell-runner dependency).
//
// NOTE on provenance: this story's own Dev Notes (Task 5) state the
// known-bad/known-good fixtures for this rule "already exist under
// apps/api/src/domain/__fixtures__/lint-guard/". That was incorrect at
// investigation time — that directory's fixtures (`lint-bad.ts`,
// `lint-bad-depth4.ts`, `lint-good.ts`, `require-bad.ts`) exercise the
// DIFFERENT, already-shipped Story 1.1 rule (`no-restricted-imports` /
// `no-require-imports` — domain purity, AD-2), not
// `no-unscoped-session-query`. At the time this file was first written,
// `no-unscoped-session-query` did not exist anywhere in the codebase
// (`packages/eslint-plugin-local/src/index.js`'s `rules` object was `{}`,
// and `eslint.config.js` had the rule wired to `'off'`) — a real Story 1.4
// gap, since AGENTS.md / project-context.md both describe the rule as
// mandatory ("Both lint rule and RLS are required — neither alone is
// sufficient"). The rule has since landed (implemented concurrently with
// this story) and is wired to `'error'` in `eslint.config.js`, with
// `apps/api/test/**/*.ts` / `apps/web/e2e/**/*.ts` exempted EXCEPT
// `__fixtures__/**` — exactly matching where this file's fixtures
// (`apps/api/test/security/__fixtures__/no-unscoped-session-query/
// {bad,good}.ts`) live, so this suite now exercises the real rule rather
// than merely documenting its absence. This test file does not own the
// rule's implementation (Story 1.4 / `packages/eslint-plugin-local/src/**`
// do) — it only proves the CLI wiring, per AC #11.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// apps/api/test/security/lint-rule-cli-enforcement.security.test.ts → repo root is 4 levels up.
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
const FIXTURE_DIR = path.join(HERE, '__fixtures__', 'no-unscoped-session-query');

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

describe('Story 5.3 AC #11 — @ai-quiz/no-unscoped-session-query wired into the real flat config', () => {
  it('the known-bad fixture (unscoped session_id query, no forUser*/assertUserOwns) fails a real eslint run with a non-zero exit', () => {
    const { code, stdout } = runEslint([`${FIXTURE_DIR}/bad.ts`]);
    expect(code).not.toBe(0);
    expect(stdout).toMatch(/no-unscoped-session-query/);
  });

  it('the known-good fixture (forUser*-wrapped, assertUserOwns called first) passes a real eslint run with exit 0', () => {
    const { code, stdout } = runEslint([`${FIXTURE_DIR}/good.ts`]);
    expect(code).toBe(0);
    expect(stdout).toBe('');
  });
});
