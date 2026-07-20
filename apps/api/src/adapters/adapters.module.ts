import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppEnvironment } from '../config/env.js';
import { WEB_SEARCH_PORT, type WebSearchPort } from '../domain/chat/ports/web-search.port.js';
import { ENRICHMENT_PORT, NoopEnrichment } from '../domain/ports/enrichment.port.js';
import { INGESTION_PORT, type IngestionPort } from '../domain/ports/ingestion.port.js';
import { LLM_PORT, type LlmPort } from '../domain/ports/llm.port.js';
import { resolveFakes } from './fake-adapters.loader.js';
import { HttpMarkdownAdapter } from './ingestion/http-markdown.adapter.js';
import { LlmAdapter } from './llm/llm.adapter.js';
import { TavilySearchAdapter } from './search/TavilySearchAdapter.js';

/**
 * Composition root for the driven adapters.
 *
 * These were previously module-level `new LlmAdapter()` singletons inside the
 * controllers, which left no seam to substitute an implementation — so the test
 * doubles were written INTO the production adapters as `setMock*` globals and
 * `NODE_ENV === 'test'` branches. Binding them to port tokens here is what makes
 * those seams deletable: a test swaps the binding instead of mutating adapter
 * state, and `apps/api/src` keeps no knowledge that tests exist.
 *
 * Global (like `ObservabilityModule`) so any driving module can inject a port
 * without re-importing this one.
 */
function readFakeConfig(
  config: ConfigService<AppEnvironment, true>,
): Pick<AppEnvironment, 'AI_QUIZ_FAKE_ADAPTERS' | 'NODE_ENV'> {
  return {
    AI_QUIZ_FAKE_ADAPTERS: config.get('AI_QUIZ_FAKE_ADAPTERS' as never) ?? [],
    NODE_ENV: config.get('NODE_ENV' as never) ?? 'development',
  };
}

@Global()
@Module({
  providers: [
    {
      provide: LLM_PORT,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<AppEnvironment, true>): Promise<LlmPort> => {
        const fakes = await resolveFakes(readFakeConfig(config));
        return fakes?.llm ?? new LlmAdapter();
      },
    },
    {
      provide: INGESTION_PORT,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<AppEnvironment, true>): Promise<IngestionPort> => {
        const fakes = await resolveFakes(readFakeConfig(config));
        return fakes?.ingestion ?? new HttpMarkdownAdapter();
      },
    },
    {
      // Story 4.2 AC #13 — an unset TAVILY_API_KEY binds `null`, so the chat
      // use-case never receives a search provider and the tool definition is
      // never constructed. The key check lives here rather than at the call
      // site so there is exactly one place that decides "search is available".
      provide: WEB_SEARCH_PORT,
      inject: [LLM_PORT, ConfigService],
      useFactory: (
        llm: LlmPort,
        config: ConfigService<AppEnvironment, true>,
      ): WebSearchPort | null => {
        const key = config.get<string>('TAVILY_API_KEY' as never);
        return typeof key === 'string' && key.length > 0 ? new TavilySearchAdapter(llm) : null;
      },
    },
    {
      provide: ENRICHMENT_PORT,
      useFactory: (): NoopEnrichment => new NoopEnrichment(),
    },
  ],
  exports: [LLM_PORT, INGESTION_PORT, WEB_SEARCH_PORT, ENRICHMENT_PORT],
})
export class AdaptersModule {}
