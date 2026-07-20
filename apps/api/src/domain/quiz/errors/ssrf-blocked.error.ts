export class SsrfBlockedError extends Error {
  public constructor(detail: string) {
    super(detail);
    this.name = 'SsrfBlockedError';
  }
}
