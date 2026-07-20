// apps/api/src/adapters/search/TavilySearchAdapter.ts
//
// Story 4.2 — the ONLY place that calls the Tavily HTTP API and the only
// place that parses the raw untrusted response. Raw `content`/`title`/`url`
// fields never leave this adapter unsummarized (AD-13): every result is
// passed through `LlmPort.summarize()` — a tool-free, separate LLM call —
// before this adapter returns anything to its caller.

import { TavilySearchResponseRowSchema } from '../../domain/chat/dto/chat.schemas.js';
import { WebSearchUnavailableError } from '../../domain/chat/errors/web-search-unavailable.error.js';
import type {
  WebSearchPort,
  WebSearchResult,
  WebSearchSource,
} from '../../domain/chat/ports/web-search.port.js';
import type { LlmPort } from '../../domain/ports/llm.port.js';

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const MAX_RESULTS = 3;
const SUMMARY_INPUT_CAP = 4_000; // bounds the concatenated-results input to the summarizer call

/**
 * Default-deny provider-configuration check (Story 4.2 AC #12). This
 * project's `GET /api/config/providers` (`providers.controller.ts`) does not
 * currently gate its listing on key presence, so there is no existing
 * shared helper to reuse without editing a file this story does not own
 * (`adapters/llm/provider-matrix.ts`). Kept local and minimal — a single,
 * obvious presence check, not duplicated logic drifting from a "real"
 * source of truth that does not exist yet.
 */
export type ConfiguredProviderId = 'minimax' | 'openrouter';

export function getConfiguredProviderIds(): ConfiguredProviderId[] {
  const ids: ConfiguredProviderId[] = [];
  if (process.env.MINIMAX_API_KEY) ids.push('minimax');
  if (process.env.OPENROUTER_API_KEY) ids.push('openrouter');
  return ids;
}

/**
 * Story 4.2 Task 4 — provider-split decision. Two providers configured: the
 * summarizer runs on whichever one is NOT the main agent's provider. One
 * provider configured: the summarizer runs on the same provider, but the
 * "separate call, tool-free system prompt" requirement is satisfied
 * structurally because `summarize()` is a wholly distinct method/call from
 * `chat()` — same provider, isolated context, no tools, regardless of
 * whether a second provider exists.
 */
export function chooseSummarizerProvider(mainAgentProvider: string): ConfiguredProviderId {
  const configured = getConfiguredProviderIds();
  if (configured.length === 0) {
    throw new WebSearchUnavailableError('no LLM provider configured for the summarizer call');
  }
  if (configured.length === 1) return configured[0]!;
  return configured.find((id) => id !== mainAgentProvider) ?? configured[0]!;
}

export class TavilySearchAdapter implements WebSearchPort {
  public constructor(private readonly llm: LlmPort) {}

  public async search(
    query: string,
    context: { readonly mainAgentProvider: string },
  ): Promise<WebSearchResult> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      // Task 5's last bullet: when TAVILY_API_KEY is unset the tool
      // definition is never constructed by the caller in the first place,
      // so in practice this branch is unreachable — but degrade gracefully
      // rather than throw a raw error if it is ever reached directly.
      throw new WebSearchUnavailableError('TAVILY_API_KEY is not configured');
    }

    let raw: unknown;
    try {
      const response = await fetch(TAVILY_SEARCH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        // NEVER set include_raw_content: true — this adapter only ever
        // reads Tavily's already-cleaned `content` field per result, and
        // even that field never leaves this adapter unsummarized.
        body: JSON.stringify({
          query,
          max_results: MAX_RESULTS,
          search_depth: 'basic',
          include_answer: false,
          include_raw_content: false,
          topic: 'general',
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new WebSearchUnavailableError(`Tavily responded ${response.status}`);
      }
      raw = await response.json();
    } catch (error) {
      if (error instanceof WebSearchUnavailableError) throw error;
      throw new WebSearchUnavailableError(`Tavily request failed: ${String(error)}`);
    }

    const parsed = TavilySearchResponseRowSchema.safeParse(raw);
    if (!parsed.success) {
      throw new WebSearchUnavailableError('Tavily returned a malformed response');
    }
    const frozen = Object.freeze(parsed.data);

    const sources: WebSearchSource[] = frozen.results.map((result) => ({
      title: result.title,
      url: result.url,
    }));

    if (frozen.results.length === 0) {
      return { summary: '', sources: [] };
    }

    // One summarizer call against a bounded concatenation of the top
    // results (Story 4.2 Dev Notes open question #3 — either approach
    // satisfies AD-13's letter; concatenating with a hard input cap keeps
    // this to exactly one dual-LLM round trip per tool call).
    const concatenated = frozen.results
      .map((result) => `${result.title}: ${result.content}`)
      .join('\n')
      .slice(0, SUMMARY_INPUT_CAP);

    const summarizerProvider = chooseSummarizerProvider(context.mainAgentProvider);
    let summary: string;
    try {
      summary = await this.llm.summarize({ text: concatenated, provider: summarizerProvider });
    } catch (error) {
      throw new WebSearchUnavailableError(`summarizer call failed: ${String(error)}`);
    }
    // Code-level hard cap, independent of whatever the summarizer returned.
    summary = summary.slice(0, 200);

    return { summary, sources };
  }
}
