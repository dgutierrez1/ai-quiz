export class DocTooLargeError extends Error {
  public constructor(detail: string) {
    super(detail);
    this.name = 'DocTooLargeError';
  }
}
