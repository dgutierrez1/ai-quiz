// Story 4.1 AC #4 — mirrors `domain/submission/errors/session-not-ready.error.ts`
// exactly (same 409-with-status precedent, AD-15). Thrown when a chat
// request targets a session whose status is 'pending' or 'failed' — the
// guard must not fall through to the 'submitted'/'ready' branches and
// expose answer content for a session that never produced any.

export type ChatUnavailableStatus = 'pending' | 'failed';

export class ChatNotAvailableError extends Error {
  public readonly code = 'CHAT_NOT_AVAILABLE' as const;
  public readonly currentStatus: ChatUnavailableStatus;

  public constructor(currentStatus: ChatUnavailableStatus) {
    super(`Chat is not available for this session (status=${currentStatus})`);
    this.name = 'ChatNotAvailableError';
    this.currentStatus = currentStatus;
  }
}
