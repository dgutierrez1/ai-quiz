import { ApiError } from './api';

/**
 * errorCopyFor — maps an ApiError to human copy (Story 2.7).
 *
 * Codes come from the backend's { error: { code, message, requestId } }
 * envelope (Story 1.5). Codes that this story cannot produce (e.g. 404,
 * 409) are intentionally absent — other stories add them when they need
 * them.
 *
 * Each entry returns the surface copy plus the field-testid suffix used by
 * the form to focus the relevant input on recovery (e.g. DOC_TOO_SHORT
 * focuses the questionCount control).
 */
export interface ErrorCopy {
  readonly title: string;
  readonly body: string;
  readonly focusTestId?: string;
}

const GENERIC: ErrorCopy = {
  title: 'We could not start the quiz.',
  body: 'Something went wrong on our end. Try again, and if it keeps happening, refresh the page.',
};

export function errorCopyFor(err: unknown): ErrorCopy {
  if (!(err instanceof ApiError)) {
    return GENERIC;
  }

  switch (err.code) {
    case 'DOC_TOO_LARGE':
      // Backend returns the same code for both size- and context-overflow
      // variants. We cannot tell them apart from here without inspecting
      // the message; default to size copy (the more common case) — the
      // message field is shown in dev tooling and request id is available.
      if (err.message.toLowerCase().includes('context')) {
        return {
          title: 'The document is longer than this model can read.',
          body: 'Switch provider or model — MiniMax-M3 handles 1M tokens.',
        };
      }
      return {
        title: 'This document is too large to process.',
        body: 'Try a more focused page.',
      };
    case 'DOC_TOO_SHORT': {
      const match = /(\d+)/.exec(err.message);
      const approx = match?.[1] ?? 'a few';
      return {
        title: 'This document is short.',
        body: `There is enough here for about ${approx} questions. Reduce the question count to continue.`,
        focusTestId: 'question-count-select',
      };
    }
    case 'SSRF_BLOCKED':
      return {
        title: 'That URL cannot be fetched.',
        body: 'It points to a private or restricted address.',
      };
    case 'BAD_REQUEST':
      return {
        title: "That doesn't look like a public document URL.",
        body: 'It should start with http:// or https://.',
      };
    case 'TOO_MANY_REQUESTS':
      // Caller should map 429 to RateLimitedState instead of using the
      // ErrorState surface. We still return a fallback here.
      return {
        title: 'You are going a bit fast.',
        body: 'Wait a moment and try again.',
      };
    case 'NOT_FOUND':
    case 'HTTP_404':
      // Story 3.2/3.3: cross-user and nonexistent sessions are
      // indistinguishable by design (FR-8) — the copy must not hint that
      // the session exists. This exact phrase is the EXPERIENCE.md
      // error-copy table entry for 404.
      return {
        title: "This session isn't available.",
        body: 'It may have expired, or it belongs to another browser.',
      };
    case 'CONFLICT':
    case 'HTTP_409':
      // Story 3.3: submit against a non-ready session. Callers generally
      // branch on the response body's status instead of showing this
      // generic copy, but it's here as a defensive fallback.
      return {
        title: "This session isn't ready to submit yet.",
        body: 'Refresh the page to see its current status.',
      };
    case 'INTERNAL_ERROR':
    case 'HTTP_500':
      return {
        title: 'We could not build a quiz from this document.',
        body: 'Retry — if it keeps happening, try a different document.',
      };
    default:
      return GENERIC;
  }
}

const CHAT_GENERIC: ErrorCopy = {
  title: "That message didn't send.",
  body: 'Try again.',
};

/**
 * chatSendErrorCopy (Story 4.3, additive) — chat-specific error copy for
 * `POST /sessions/:id/chat` failures. Reuses `errorCopyFor`'s code table
 * where a code has meaningful chat-facing copy, but swaps the fallback for
 * chat voice ("That message didn't send. Try again.") instead of the
 * landing page's "We could not start the quiz." — EXPERIENCE.md Voice and
 * Tone: second person, present tense, no blame.
 *
 * 429 is handled separately by the caller via `RateLimitedState` (reusing
 * its countdown rather than reimplementing it) — this function is not
 * consulted for that case.
 */
export function chatSendErrorCopy(err: unknown): ErrorCopy {
  if (!(err instanceof ApiError)) {
    return CHAT_GENERIC;
  }
  if (err.code === 'CONFLICT' || err.code === 'HTTP_409') {
    // Defense-in-depth only — Story 3.2's guard means a submitted-session
    // ChatPanel should never actually reach a 409, but the mutation error
    // handler must not crash if the server disagrees.
    return {
      title: "This session isn't ready to chat yet.",
      body: 'Refresh the page to see its current status.',
    };
  }
  return CHAT_GENERIC;
}
