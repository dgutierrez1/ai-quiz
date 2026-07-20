import { getTestDoubles, resetTestDoubles } from '@ai-quiz/test-doubles';
import { describe, expect, it } from 'vitest';

import type { IngestionPort } from '../../src/domain/ports/ingestion.port.js';
import type { LlmPort } from '../../src/domain/ports/llm.port.js';

/**
 * Closes the one unchecked seam in the test-double wiring.
 *
 * `apps/api/src/adapters/fake-adapters.loader.ts` casts the dynamically
 * imported `@ai-quiz/test-doubles` module to a locally-declared shape, because
 * the package cannot import the real port types without creating a build cycle
 * (api devDepends on it). That cast would happily accept a fake whose
 * `chat()` signature had drifted.
 *
 * These assignments are the check. They are compile-time only — `pnpm typecheck`
 * fails if either fake stops structurally satisfying its port, which is when
 * you want to find out, rather than during a test run that mysteriously
 * stopped exercising what it claimed to.
 */
describe('test doubles conform to the real ports', () => {
  it('FakeLlmAdapter satisfies LlmPort and FakeIngestionAdapter satisfies IngestionPort', () => {
    const doubles = getTestDoubles();

    const llm: LlmPort = doubles.llm;
    const ingestion: IngestionPort = doubles.ingestion;

    expect(typeof llm.generateQuiz).toBe('function');
    expect(typeof llm.chat).toBe('function');
    expect(typeof llm.summarize).toBe('function');
    expect(typeof ingestion.fetchMarkdown).toBe('function');
  });

  it('getTestDoubles returns a stable singleton so DI and the test share state', () => {
    expect(getTestDoubles()).toBe(getTestDoubles());

    getTestDoubles().llm.summarizeResponse = 'configured';
    expect(getTestDoubles().llm.summarizeResponse).toBe('configured');

    resetTestDoubles();
    expect(getTestDoubles().llm.summarizeResponse).toBeNull();
  });
});
