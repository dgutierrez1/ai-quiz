export class IncompleteSubmissionError extends Error {
  public readonly code = 'INCOMPLETE_SUBMISSION' as const;

  public constructor(message: string) {
    super(message);
    this.name = 'IncompleteSubmissionError';
  }
}
