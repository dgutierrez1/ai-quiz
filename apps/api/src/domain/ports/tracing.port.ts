/**
 * Outbound port for LLM observability (NFR-3 / spine AD-N9).
 *
 * This file lives in `domain/` and is therefore PURE: no `@nestjs/*`, no
 * `drizzle-orm`, no `undici`, no `pino`, no Langfuse SDK. It is a plain
 * interface over plain data so use-cases can record traces without knowing
 * whether anything is actually listening.
 *
 * Privacy contract (constitution rule 9): implementations record trace
 * METADATA. They must never receive or forward a raw API key, and identity is
 * carried as a SHA-256 `userIdHash`, never the raw user id.
 */

export interface LlmGenerationTrace {
  /** Logical name of the call, e.g. `generate-quiz` or `chat-summarize`. */
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  /** Prompt text. Implementations may truncate or drop it under retention policy. */
  readonly input?: string;
  readonly output?: string;
  readonly latencyMs?: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly cacheHit?: boolean;
  readonly sessionId?: string;
  /** SHA-256 of the internal users.id. NEVER the raw id. */
  readonly userIdHash?: string;
  /** Set when the call failed, so failures are traceable too. */
  readonly error?: string;
}

export interface TracingPort {
  /**
   * Record one LLM generation. Implementations MUST NOT throw — observability
   * is never a correctness dependency, so a tracing outage cannot fail a quiz.
   */
  recordGeneration(trace: LlmGenerationTrace): Promise<void>;

  /** Best-effort flush. Also must not throw. */
  flush(): Promise<void>;

  /**
   * Retention (Story 4.4): drop captured trace payloads older than the cutoff.
   * Returns how many traces were removed, or 0 for a no-op implementation.
   */
  deleteTracesOlderThan(cutoff: Date): Promise<{ readonly deletedCount: number }>;
}

export const TRACING_PORT = Symbol('TracingPort');
