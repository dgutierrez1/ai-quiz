export class IngestTimeoutError extends Error {
  public constructor(detail: string) {
    super(detail);
    this.name = 'IngestTimeoutError';
  }
}
