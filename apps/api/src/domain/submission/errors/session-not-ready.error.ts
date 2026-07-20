export type NotReadySessionStatus = 'pending' | 'failed';

export class SessionNotReadyError extends Error {
  public readonly code = 'SESSION_NOT_READY' as const;
  public readonly status: NotReadySessionStatus;

  public constructor(status: NotReadySessionStatus) {
    super(`Session is not ready for submission (status=${status})`);
    this.name = 'SessionNotReadyError';
    this.status = status;
  }
}
