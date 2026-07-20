// Fixture for `@ai-quiz/local/no-test-seams-in-src`. Deliberately CLEAN — the
// companion test asserts ESLint reports nothing here, which is what proves the
// rule is precise rather than merely loud. Never imported by application code.
//
// Manual check:
//   pnpm exec eslint --no-ignore apps/api/test/fixtures/test-seams/seams-good.ts

export interface FakePool {
  readonly questions: readonly string[];
}

// ALLOWED — comparisons against 'production' describe production behavior, not
// test behavior. `main.ts` uses this shape for the dev-only CORS regex and
// `health.controller.ts` for the memory block in the health response.
export function corsOriginIsPermissive(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export function includeDiagnostics(): boolean {
  return process.env.NODE_ENV === 'development';
}

// ALLOWED — reading NODE_ENV without comparing it to 'test'.
export function currentEnvironment(): string {
  return process.env.NODE_ENV ?? 'development';
}

// ALLOWED — "Mock"/"Fake" in a name that is not a set/get/reset seam.
export function buildFakePoolForDisplay(prompt: string): FakePool {
  return { questions: [prompt] };
}

// ALLOWED — a setter that has nothing to do with test doubles.
export function setPoolSize(_size: number): void {
  // no-op
}

// ALLOWED — not exported, so it is not a seam other modules can reach.
let internalCache: FakePool | null = null;
function resetInternalMock(): void {
  internalCache = null;
}

export function generate(prompt: string): FakePool {
  resetInternalMock();
  return internalCache ?? { questions: [prompt] };
}
