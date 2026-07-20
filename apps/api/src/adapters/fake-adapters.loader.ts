import type { AppEnvironment } from '../config/env.js';
import type { IngestionPort } from '../domain/ports/ingestion.port.js';
import type { LlmPort } from '../domain/ports/llm.port.js';

/**
 * Structural view of `@ai-quiz/test-doubles`.
 *
 * The api side owns this typing on purpose. The test-doubles package cannot
 * import `LlmPort` from here — `apps/api` devDepends on that package, so the
 * reverse import would be a build cycle. Declaring the shape locally keeps the
 * dependency one-directional.
 *
 * The cast in `resolveFakes` is therefore unchecked at this boundary. It is
 * closed instead by `apps/api/test/doubles/conformance.type-test.ts`, which
 * assigns the real fakes to the real port types — so a fake that drifts out of
 * shape fails `pnpm typecheck`, not a test run at 3am. Weaker than an
 * `implements` clause, and deliberately so.
 */
interface TestDoublesModule {
  getTestDoubles(): { llm: LlmPort; ingestion: IngestionPort };
}

export interface ResolvedFakes {
  readonly llm: LlmPort | null;
  readonly ingestion: IngestionPort | null;
}

/**
 * Resolve the fake adapters named by `AI_QUIZ_FAKE_ADAPTERS`, or `null` when
 * the flag is empty (the production case — the overwhelmingly common one, and
 * the one that must never touch the test-doubles package at all).
 *
 * The dynamic `import()` matters: with the flag unset this module is never
 * resolved, so a production image that lacks `@ai-quiz/test-doubles` entirely
 * still boots. That is what lets the Dockerfile delete the package outright.
 */
export async function resolveFakes(
  environment: Pick<AppEnvironment, 'AI_QUIZ_FAKE_ADAPTERS' | 'NODE_ENV'>,
): Promise<ResolvedFakes | null> {
  const ports = environment.AI_QUIZ_FAKE_ADAPTERS;
  if (!ports || ports.length === 0) return null;

  // Defense in depth. `validateEnv()` already refuses to boot on this
  // combination, but tests call `createApplication()` directly and bypass it,
  // so the guard is repeated at the point the fake actually gets constructed.
  if (environment.NODE_ENV === 'production') {
    throw new Error(
      'AI_QUIZ_FAKE_ADAPTERS is set under NODE_ENV=production — refusing to construct fake adapters.',
    );
  }

  const module = (await import('@ai-quiz/test-doubles')) as unknown as TestDoublesModule;
  const doubles = module.getTestDoubles();

  return {
    llm: ports.includes('llm') ? doubles.llm : null,
    ingestion: ports.includes('ingestion') ? doubles.ingestion : null,
  };
}
