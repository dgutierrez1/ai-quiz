// apps/api/src/domain/chat/ports/web-search.port.ts
//
// Story 4.2 AC #9. Pure interface — zero I/O imports (AD-2). Returns an
// ALREADY-SANITIZED `WebSearchResult`: `{summary <=200 chars, sources}`.
// The port never exposes raw Tavily content to any caller, so no downstream
// consumer can accidentally forward unsanitized text into the main agent
// context (AD-13).

export interface WebSearchSource {
  readonly title: string;
  readonly url: string;
}

export interface WebSearchResult {
  readonly summary: string;
  readonly sources: readonly WebSearchSource[];
}

export interface WebSearchPort {
  search(query: string, context: { readonly mainAgentProvider: string }): Promise<WebSearchResult>;
}

/**
 * Bound to `null` when `TAVILY_API_KEY` is unset — AC #9's "no search provider
 * configured" state is represented in the container, not re-derived from
 * `process.env` at each call site.
 */
export const WEB_SEARCH_PORT = Symbol('WebSearchPort');
