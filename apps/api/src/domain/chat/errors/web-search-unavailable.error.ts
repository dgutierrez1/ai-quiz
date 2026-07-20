// Story 4.2 — thrown by `TavilySearchAdapter` on network error, non-2xx, or
// schema-parse failure. `ChatUseCase` catches this per tool call and treats
// it as "no result for this tool call" — Tavily failures degrade gracefully,
// they never surface as a 5xx from the chat endpoint.
export class WebSearchUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'WebSearchUnavailableError';
  }
}
