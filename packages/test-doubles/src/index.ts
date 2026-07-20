import { FakeIngestionAdapter } from './fake-ingestion.adapter.js';
import { FakeLlmAdapter } from './fake-llm.adapter.js';

export * from './fake-ingestion.adapter.js';
export * from './fake-llm.adapter.js';

export interface TestDoubles {
  readonly llm: FakeLlmAdapter;
  readonly ingestion: FakeIngestionAdapter;
}

let singleton: TestDoubles | null = null;

/**
 * Process-wide singleton so the DI factory inside the booted api and the test
 * that wants to configure it see the SAME instances. The api resolves this
 * package through a dynamic `import()`, and the test imports it directly —
 * ESM module caching is what makes those the same object.
 */
export function getTestDoubles(): TestDoubles {
  singleton ??= { llm: new FakeLlmAdapter(), ingestion: new FakeIngestionAdapter() };
  return singleton;
}

/** Clear all recorded calls and configured responses. Call between tests. */
export function resetTestDoubles(): void {
  if (!singleton) return;
  singleton.llm.reset();
  singleton.ingestion.reset();
}
