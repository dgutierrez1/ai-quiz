/**
 * Raised when an LLM call is attempted with no API key for the requested
 * provider.
 *
 * This exists because the alternative the adapter used to take — returning a
 * deterministic mock pool — was the single worst failure this system could
 * have: a user receives invented questions presented as grounded in their
 * document, and nothing about the response looks wrong. A misconfiguration
 * must surface as a misconfiguration.
 */
export class LlmNotConfiguredError extends Error {
  public readonly code = 'LLM_NOT_CONFIGURED' as const;

  public constructor(public readonly provider: string) {
    super(
      `No API key configured for LLM provider "${provider}". ` +
        `Set MINIMAX_API_KEY or OPENROUTER_API_KEY.`,
    );
    this.name = 'LlmNotConfiguredError';
  }
}
