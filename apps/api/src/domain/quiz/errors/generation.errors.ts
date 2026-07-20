export class UntrustedLlmOutputError extends Error {
  public readonly code = 'UNTRUSTED_LLM_OUTPUT' as const;
  public constructor(message: string) {
    super(message);
    this.name = 'UntrustedLlmOutputError';
  }
}
export class LlmOutputEmptyError extends Error {
  public readonly code = 'LLM_OUTPUT_EMPTY' as const;
  public constructor(message: string) {
    super(message);
    this.name = 'LlmOutputEmptyError';
  }
}
export class LlmRetryExhaustedError extends Error {
  public readonly code = 'LLM_RETRY_EXHAUSTED' as const;
  public override readonly cause: unknown;
  public constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'LlmRetryExhaustedError';
    this.cause = cause;
  }
}
