export class DocTooShortError extends Error {
  public constructor(detail: string) {
    super(detail);
    this.name = 'DocTooShortError';
  }
}
