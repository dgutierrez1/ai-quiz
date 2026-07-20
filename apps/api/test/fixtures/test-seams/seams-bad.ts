// Fixture for `@ai-quiz/local/no-test-seams-in-src`. Deliberately violating —
// `test/security/no-test-seams.test.ts` runs ESLint against this file and
// asserts it reports. Never imported by application code.
//
// Manual check:
//   pnpm exec eslint --no-ignore apps/api/test/fixtures/test-seams/seams-bad.ts

export interface FakePool {
  readonly questions: readonly string[];
}

// VIOLATION 1 — exported mock setter holding module-global state.
let override: FakePool | null = null;
export function setMockPoolResponse(pool: FakePool | null): void {
  override = pool;
}

// VIOLATION 2 — exported test-inspection getter.
export function getLastCallFake(): FakePool | null {
  return override;
}

// VIOLATION 3 — exported reset helper, arrow-function form.
export const resetPoolStub = (): void => {
  override = null;
};

export function generate(prompt: string): FakePool {
  // VIOLATION 4 — production branch on the test environment.
  if (process.env.NODE_ENV === 'test') {
    return { questions: [`${prompt} — mock`] };
  }
  // VIOLATION 5 — same comparison, bracket form and reversed operands.
  if ('test' !== process.env['NODE_ENV']) {
    return { questions: [prompt] };
  }
  return override ?? { questions: [] };
}
