export class NotFoundError extends Error {
  public constructor() {
    super('Resource not found');
    this.name = 'NotFoundError';
  }
}
