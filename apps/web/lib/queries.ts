'use client';
import type {
  CreateSessionRequest,
  ProviderListResponse,
  SessionCreatedResponse,
} from '@ai-quiz/shared';
import {
  type InfiniteData,
  useInfiniteQuery,
  type UseInfiniteQueryResult,
  useMutation,
  type UseMutationResult,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  api,
  type ChatHistoryResponse,
  type SendChatMessageResponse,
  type SessionsListResponse,
} from './api';
import type { SessionDetailResponse, SubmitAnswersRequest, SubmitAnswersResponse } from './types';
/**
 * Query-keys factory (Story 2.7). Every later story's hooks extend this one
 * factory — never invent a parallel one.
 *
 * The factory shape mirrors TanStack Query's recommended pattern: keys are
 * hierarchical arrays whose first element is a domain, whose second is the
 * resource, and whose trailing elements are parameters.
 */
export const queryKeys = {
  providers: () => ['providers'] as const,
  sessions: {
    all: () => ['sessions'] as const,
    detail: (id: string) => ['sessions', id] as const,
    /** Story 4.3 Task 3. */
    chat: (id: string) => ['sessions', id, 'chat'] as const,
    /** Story 5.1 Task 4 — `GET /api/sessions` (history sidebar). */
    list: () => ['sessions', 'list'] as const,
  },
} as const;

export function useProvidersQuery(): UseQueryResult<ProviderListResponse, Error> {
  return useQuery<ProviderListResponse, Error>({
    queryKey: queryKeys.providers(),
    queryFn: ({ signal }) => api.getProviders(signal),
    staleTime: 60_000,
  });
}

export interface CreateSessionInput {
  readonly request: CreateSessionRequest;
  readonly signal?: AbortSignal;
}

/**
 * useCreateSessionMutation (Story 2.7; `onSuccess` extended by Story 5.1
 * Task 4). Invalidating `queryKeys.sessions.list()` on success is what
 * makes a freshly created session appear in the history sidebar without
 * requiring a manual refresh or a second unrelated cache event to happen
 * to fire first.
 */
export function useCreateSessionMutation(): UseMutationResult<
  SessionCreatedResponse,
  Error,
  CreateSessionInput
> {
  const queryClient = useQueryClient();
  return useMutation<SessionCreatedResponse, Error, CreateSessionInput>({
    mutationFn: ({ request, signal }) => api.createSession(request, signal),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.list() });
    },
  });
}

/**
 * useSessionQuery (Story 3.2/3.3) — `GET /api/sessions/:id`. Consumed by
 * both `/quiz/[id]` (status branching while `ready`/`pending`/`failed`)
 * and `/result/[id]` (renders only `submitted`, redirects otherwise).
 * `retry: false` matches the rest of this factory — a 404/failed session
 * should surface immediately, not retry against a per-route rate limit.
 */
export function useSessionQuery(id: string): UseQueryResult<SessionDetailResponse, Error> {
  return useQuery<SessionDetailResponse, Error>({
    queryKey: queryKeys.sessions.detail(id),
    queryFn: ({ signal }) => api.getSession(id, signal),
    enabled: id.length > 0,
    retry: false,
  });
}

export interface SubmitAnswersInput {
  readonly request: SubmitAnswersRequest;
  readonly signal?: AbortSignal;
}

/**
 * useSubmitAnswersMutation (Story 3.3) — `POST /api/sessions/:id/submit`.
 * Fired once, on the final question's Submit click; the caller
 * (`quiz-runner.tsx`) owns navigation on success and error-branch
 * rendering (409/429/generic) around the call.
 */
export function useSubmitAnswersMutation(
  id: string,
): UseMutationResult<SubmitAnswersResponse, Error, SubmitAnswersInput> {
  return useMutation<SubmitAnswersResponse, Error, SubmitAnswersInput>({
    mutationFn: ({ request, signal }) => api.submitAnswers(id, request, signal),
  });
}

/**
 * useChatHistoryQuery (Story 4.3 Task 3) — `GET /api/sessions/:id/chat`,
 * latest 50 messages. `ChatPanel` degrades gracefully if this errors (the
 * chat backend, Story 4.1, does not exist yet): a query error is treated
 * as "no messages yet" rather than a hard failure, so this hook keeps
 * `retry: false` to surface that quickly instead of hammering a 404.
 */
export function useChatHistoryQuery(sessionId: string): UseQueryResult<ChatHistoryResponse, Error> {
  return useQuery<ChatHistoryResponse, Error>({
    queryKey: queryKeys.sessions.chat(sessionId),
    queryFn: ({ signal }) => api.getChatHistory(sessionId, undefined, signal),
    enabled: sessionId.length > 0,
    retry: false,
  });
}

export interface LoadOlderChatInput {
  /** Cursor — the oldest currently-loaded message's `createdAt`, NOT an offset. */
  readonly before: string;
}

/**
 * useLoadOlderChatMutation (Story 4.3 Task 3) — "view older" fetches the
 * previous batch via a `before` cursor. Modeled as a mutation (not part of
 * the `sessions.chat` query's cache) so the caller can merge the returned
 * batch into its own ordered thread state and control scroll-anchoring
 * without fighting TanStack Query's own refetch/cache semantics.
 */
export function useLoadOlderChatMutation(
  sessionId: string,
): UseMutationResult<ChatHistoryResponse, Error, LoadOlderChatInput> {
  return useMutation<ChatHistoryResponse, Error, LoadOlderChatInput>({
    mutationFn: ({ before }) => api.getChatHistory(sessionId, before),
  });
}

export interface SendChatMessageInput {
  readonly content: string;
}

/**
 * useSendChatMessageMutation (Story 4.3 Task 3) — `POST /api/sessions/:id/chat`.
 * Optimistic bookkeeping (the "sending" bubble, rollback-to-error-state on
 * failure per AC #5) lives in `ChatPanel`'s own component state rather than
 * in `onMutate`/`onError` here — the UI needs per-message sending/error
 * status for potentially several concurrently-errored bubbles, which is a
 * better fit for local state than for the single `sessions.chat` query's
 * cache entry.
 */
export function useSendChatMessageMutation(
  sessionId: string,
): UseMutationResult<SendChatMessageResponse, Error, SendChatMessageInput> {
  return useMutation<SendChatMessageResponse, Error, SendChatMessageInput>({
    mutationFn: ({ content }) => api.sendChatMessage(sessionId, content),
  });
}

const SESSIONS_PAGE_SIZE = 20;

/**
 * useSessionsInfiniteQuery (Story 5.1 Task 4) — `GET /api/sessions`, the
 * history sidebar's data source. `initialPageParam: undefined` matches the
 * backend's "omit `before` on the first page" contract; `getNextPageParam`
 * derives the next cursor from `hasMore` + the last row's `createdAt`
 * (`undefined` tells TanStack Query there is no next page, which also
 * turns off `hasNextPage`/hides "load more").
 */
export function useSessionsInfiniteQuery(): UseInfiniteQueryResult<
  InfiniteData<SessionsListResponse>,
  Error
> {
  return useInfiniteQuery<
    SessionsListResponse,
    Error,
    InfiniteData<SessionsListResponse>,
    ReturnType<typeof queryKeys.sessions.list>,
    string | undefined
  >({
    queryKey: queryKeys.sessions.list(),
    queryFn: ({ pageParam, signal }) =>
      api.listSessions({ limit: SESSIONS_PAGE_SIZE, before: pageParam }, signal),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.sessions.at(-1)?.createdAt : undefined,
    retry: false,
  });
}
