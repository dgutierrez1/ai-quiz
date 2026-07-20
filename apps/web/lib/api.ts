import type {
  CreateSessionRequest,
  ProviderListResponse,
  QuizSessionStatus,
  SessionCreatedResponse,
} from '@ai-quiz/shared';

import type { SessionDetailResponse, SubmitAnswersRequest, SubmitAnswersResponse } from './types';

/**
 * api — single fetch surface for the web app (Story 2.7).
 *
 * Every API call MUST go through here so:
 *   • X-User-Id is attached automatically (the UUID lives in the head script
 *     before hydration; we read it from localStorage on demand).
 *   • The { error: { code, message, requestId } } envelope (Story 1.5) is
 *     parsed into a typed `ApiError` the UI can map to human copy.
 *   • 429 responses expose `retryAfter` for `RateLimitedState`.
 *
 * Never call `fetch` directly elsewhere in the web tree.
 */

// Must match the API's own default port (`API_PORT`, 4000 — see .env.example
// and the README quick-start). This default is what a plain `pnpm dev` uses,
// so a mismatch here silently breaks every request in local development while
// leaving the E2E suite green, because Playwright passes NEXT_PUBLIC_API_URL
// explicitly and therefore never exercises the fallback.
const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly requestId?: string | undefined;
  public readonly retryAfter?: number | undefined;

  public constructor(params: {
    status: number;
    code: string;
    message: string;
    requestId?: string;
    retryAfter?: number;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.status = params.status;
    this.code = params.code;
    this.requestId = params.requestId;
    this.retryAfter = params.retryAfter;
  }
}

interface EnvelopeError {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId?: string;
  };
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

function readUserId(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    const raw = window.localStorage.getItem('ai-quiz.user.id');
    if (raw && UUID_V4.test(raw)) {
      return raw;
    }
  } catch {
    /* ignore storage failures */
  }
  return undefined;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const asInt = Number.parseInt(value, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt;
  // HTTP-date form is not used by NestJS @nestjs/throttler v6 (it emits seconds).
  return undefined;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const userId = readUserId();
  if (userId) {
    headers['X-User-Id'] = userId;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    credentials: 'omit',
    cache: 'no-store',
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const json = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    const envelope = json as EnvelopeError | undefined;
    const code = envelope?.error?.code ?? `HTTP_${response.status}`;
    const message = envelope?.error?.message ?? response.statusText;
    throw new ApiError({
      status: response.status,
      code,
      message,
      requestId: envelope?.error?.requestId,
      retryAfter: parseRetryAfter(response.headers.get('retry-after')),
    });
  }

  return json as T;
}

/**
 * Chat DTOs (Story 4.3, provisional — Story 4.1's chat backend does not
 * exist yet). Shapes are derived from epics.md Story 4.1's ACs + the PRD +
 * the ERD; see the story file's Dev Notes § Chat API contract. Reconcile
 * against Story 4.1's actual response shapes once it lands.
 */
export interface ChatSourceDto {
  readonly title: string;
  readonly url: string;
}

export interface ChatMessageDto {
  readonly id: string;
  readonly sessionId: string;
  readonly role: 'user' | 'assistant';
  /** `null` = tombstoned (Story 4.4, 7-day scrub). */
  readonly content: string | null;
  readonly sources: readonly ChatSourceDto[] | null;
  /** Opaque to the UI — only used to render a compact badge (AC #11). */
  readonly toolCalls: readonly unknown[] | null;
  readonly model: string | null;
  /** Present, but NEVER rendered (AC #10, EXPERIENCE.md Open Item #5). */
  readonly thinking: unknown | null;
  readonly createdAt: string;
}

export interface ChatHistoryResponse {
  readonly messages: readonly ChatMessageDto[];
}

export interface SendChatMessageResponse {
  readonly userMessage: ChatMessageDto;
  readonly assistantMessage: ChatMessageDto;
}

/**
 * Session-history DTOs (Story 5.1 Task 4). Mirror
 * `apps/api/src/driving/sessions/dto/sessions-list.schemas.ts`'s
 * `SessionSummarySchema` / `SessionsListResponseSchema` — deliberately
 * minimal (id, sourceUrl, status, createdAt only), per that file's own
 * comment on why it isn't in `packages/shared` yet. `createdAt` arrives as
 * an ISO string over JSON (the backend's `z.date()` serializes through
 * `JSON.stringify` before it reaches fetch).
 */
export interface SessionSummaryDto {
  readonly id: string;
  readonly sourceUrl: string;
  readonly status: QuizSessionStatus;
  readonly createdAt: string;
}

export interface SessionsListResponse {
  readonly sessions: readonly SessionSummaryDto[];
  readonly hasMore: boolean;
}

export const api = {
  async getProviders(signal?: AbortSignal): Promise<ProviderListResponse> {
    return request<ProviderListResponse>('/api/config/providers', { signal });
  },

  async createSession(
    input: CreateSessionRequest,
    signal?: AbortSignal,
  ): Promise<SessionCreatedResponse> {
    return request<SessionCreatedResponse>('/api/sessions', {
      method: 'POST',
      body: input,
      signal,
    });
  },

  /**
   * GET /api/sessions/:id (Story 3.2/3.3). Response shape depends on the
   * session's status — see `lib/types.ts` for the working-assumption
   * discriminated union. A 404 (not-found or not-owned, indistinguishable
   * by design) surfaces as an `ApiError` with `status === 404`.
   */
  async getSession(id: string, signal?: AbortSignal): Promise<SessionDetailResponse> {
    return request<SessionDetailResponse>(`/api/sessions/${id}`, { signal });
  },

  /**
   * POST /api/sessions/:id/submit (Story 3.3). See `lib/types.ts` for the
   * request/response shape this story builds against.
   */
  async submitAnswers(
    id: string,
    input: SubmitAnswersRequest,
    signal?: AbortSignal,
  ): Promise<SubmitAnswersResponse> {
    return request<SubmitAnswersResponse>(`/api/sessions/${id}/submit`, {
      method: 'POST',
      body: input,
      signal,
    });
  },

  /**
   * GET /api/sessions/:id/chat (Story 4.3 Task 3). Latest 50 messages, no
   * `limit`/`offset` — `before` is a cursor (the oldest currently-loaded
   * message's `createdAt`), used by the "view older" control.
   */
  async getChatHistory(
    id: string,
    before?: string,
    signal?: AbortSignal,
  ): Promise<ChatHistoryResponse> {
    const query = before ? `?before=${encodeURIComponent(before)}` : '';
    return request<ChatHistoryResponse>(`/api/sessions/${id}/chat${query}`, { signal });
  },

  /**
   * POST /api/sessions/:id/chat (Story 4.3 Task 3). Body is `{ content }`
   * only — no `questionId`, no anchor field; chat is fully decoupled from
   * questions (AC #7).
   */
  async sendChatMessage(
    id: string,
    content: string,
    signal?: AbortSignal,
  ): Promise<SendChatMessageResponse> {
    return request<SendChatMessageResponse>(`/api/sessions/${id}/chat`, {
      method: 'POST',
      body: { content },
      signal,
    });
  },

  /**
   * GET /api/sessions (Story 5.1 Task 4). `before` is the `createdAt` of
   * the last row from the previous page (exclusive cursor) — omitted on
   * the first page.
   */
  async listSessions(
    params: { limit?: number; before?: string } = {},
    signal?: AbortSignal,
  ): Promise<SessionsListResponse> {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.before !== undefined) query.set('before', params.before);
    const qs = query.toString();
    return request<SessionsListResponse>(`/api/sessions${qs ? `?${qs}` : ''}`, { signal });
  },
} as const;
