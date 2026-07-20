'use client';

import type {
  CreateSessionRequest,
  QuizSessionProvider,
  QuizSessionStrategy,
} from '@ai-quiz/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError } from '../../lib/api';
import { type ErrorCopy, errorCopyFor } from '../../lib/error-copy';
import { defaultModelForProvider, modelsForProvider, V1_PROVIDERS } from '../../lib/providers';
import { useCreateSessionMutation, useProvidersQuery } from '../../lib/queries';
import { EmptyState } from '../states/empty-state';
import { ErrorState } from '../states/error-state';
import { NarratedWait, type NarratedWaitStage } from '../states/narrated-wait';
import { RateLimitedState } from '../states/rate-limited-state';
import { ProviderModelSelect } from './provider-model-select';
import { type QuestionCount, QuestionCountSelect } from './question-count-select';
import { StrategyPicker } from './strategy-picker';

const URL_TOPIC_MAX = 200;
const URL_PATTERN = /^https?:\/\/.+/i;

const GENERATION_STAGES: readonly NarratedWaitStage[] = [
  { atMs: 0, text: 'Fetching the document…' },
  { atMs: 3000, text: 'Reading it through…' },
  { atMs: 8000, text: 'Writing your questions…' },
  { atMs: 20000, text: 'Almost there — longer documents take a little more thought.' },
];

interface FormState {
  readonly url: string;
  readonly topic: string;
  readonly strategy: QuizSessionStrategy | undefined;
  readonly provider: QuizSessionProvider;
  readonly model: string;
  readonly questionCount: QuestionCount;
}

const INITIAL_FORM: FormState = {
  url: '',
  topic: '',
  strategy: undefined,
  provider: 'minimax',
  model: defaultModelForProvider(undefined, 'minimax'),
  questionCount: 8,
};

interface SessionFormProps {
  /**
   * History-row retry prefill (Story 5.1 Task 6). Set by the page-level
   * `prefillUrl` state (`app/page.tsx`, plain `useState` — not a third
   * React Context, AD-17) when a `failed` history row's retry button is
   * clicked. Every change (including the same value clicked twice) should
   * re-focus the URL field, which is why the parent resets this back to
   * `undefined` via `onPrefillConsumed` after each application.
   */
  readonly prefillUrl?: string;
  /** Fired once the prefill has been applied and the field focused. */
  readonly onPrefillConsumed?: () => void;
}

export function SessionForm({
  prefillUrl,
  onPrefillConsumed,
}: SessionFormProps = {}): React.JSX.Element {
  const router = useRouter();
  const providersQuery = useProvidersQuery();
  const createSession = useCreateSessionMutation();

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [submitAttempted, setSubmitAttempted] = useState<boolean>(false);
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);
  const [errorCopy, setErrorCopy] = useState<ErrorCopy | null>(null);
  const sourceUrlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (prefillUrl === undefined) return;
    setForm((prev) => ({ ...prev, url: prefillUrl }));
    setSubmitAttempted(false);
    setErrorCopy(null);
    setRateLimitSeconds(null);
    sourceUrlInputRef.current?.focus();
    onPrefillConsumed?.();
    // Deliberately keyed on `prefillUrl` alone — `onPrefillConsumed` is a
    // stable callback from the page (Story 5.1 Task 6), and including it
    // (or the setState calls) here would re-run this effect on every
    // unrelated form-state change instead of only on a new prefill.
  }, [prefillUrl]);

  const liveProviders = providersQuery.data;
  const liveProviderIds = useMemo<readonly QuizSessionProvider[]>(() => {
    if (!liveProviders) return V1_PROVIDERS;
    const present = (Object.keys(liveProviders) as QuizSessionProvider[]).filter(
      (k) => Array.isArray(liveProviders[k]) && liveProviders[k]!.length > 0,
    );
    return present.length > 0 ? present : V1_PROVIDERS;
  }, [liveProviders]);

  const urlError =
    form.url.length === 0
      ? 'A document URL is required.'
      : !URL_PATTERN.test(form.url)
        ? "That doesn't look like a public document URL. It should start with http:// or https://."
        : null;

  const topicError =
    form.topic.length > URL_TOPIC_MAX
      ? `Topic hints are limited to ${URL_TOPIC_MAX} characters.`
      : null;

  const strategyError = form.strategy === undefined ? 'Pick a strategy before starting.' : null;

  const formValid = urlError === null && topicError === null && strategyError === null;

  const isSubmitting = createSession.isPending;
  const lockForm = isSubmitting;

  const setUrl = useCallback((next: string) => {
    setForm((prev) => ({ ...prev, url: next }));
  }, []);

  const setTopic = useCallback((next: string) => {
    setForm((prev) => ({ ...prev, topic: next }));
  }, []);

  const setStrategy = useCallback((next: QuizSessionStrategy) => {
    setForm((prev) => ({ ...prev, strategy: next }));
  }, []);

  const setProvider = useCallback(
    (next: QuizSessionProvider) => {
      setForm((prev) => ({
        ...prev,
        provider: next,
        model: defaultModelForProvider(liveProviders, next),
      }));
    },
    [liveProviders],
  );

  const setModel = useCallback((next: string) => {
    setForm((prev) => ({ ...prev, model: next }));
  }, []);

  const setQuestionCount = useCallback((next: QuestionCount) => {
    setForm((prev) => ({ ...prev, questionCount: next }));
  }, []);

  const buildRequest = useCallback((): CreateSessionRequest => {
    if (form.strategy === undefined) {
      throw new Error('strategy required');
    }
    const request: CreateSessionRequest = {
      sourceUrl: form.url.trim(),
      strategy: form.strategy,
      questionCount: form.questionCount,
      provider: form.provider,
      model: form.model,
    };
    if (form.topic.trim().length > 0) {
      (request as CreateSessionRequest & { topic?: string }).topic = form.topic.trim();
    }
    return request;
  }, [form]);

  const handleSubmit = useCallback(
    (event?: React.FormEvent) => {
      if (event) event.preventDefault();
      setSubmitAttempted(true);
      setErrorCopy(null);
      setRateLimitSeconds(null);
      if (!formValid) return;
      createSession.mutate(
        { request: buildRequest() },
        {
          onSuccess: (response) => {
            if (response.status === 'ready') {
              router.push(`/quiz/${response.id}`);
              return;
            }
            // For pending/failed, we surface an error rather than routing.
            setErrorCopy({
              title: 'We could not start the quiz.',
              body: 'The server did not return a ready session. Retry in a moment.',
            });
          },
          onError: (err) => {
            if (
              err instanceof ApiError &&
              err.status === 429 &&
              typeof err.retryAfter === 'number'
            ) {
              setRateLimitSeconds(err.retryAfter);
              return;
            }
            setErrorCopy(errorCopyFor(err));
          },
        },
      );
    },
    [buildRequest, createSession, formValid, router],
  );

  const handleRetry = useCallback(() => {
    handleSubmit();
  }, [handleSubmit]);

  const providersResolved = !providersQuery.isLoading && !providersQuery.isError;
  const providersEmpty =
    providersResolved &&
    providersQuery.data !== undefined &&
    Object.values(providersQuery.data).every((list) => !list || list.length === 0);

  // Show the rate-limited countdown surface while active.
  if (rateLimitSeconds !== null) {
    return (
      <RateLimitedState
        retryAfterSeconds={rateLimitSeconds}
        onElapsed={() => {
          setRateLimitSeconds(null);
        }}
      />
    );
  }

  // Show the failure surface while a non-429 error has been mapped.
  if (errorCopy) {
    return <ErrorState copy={errorCopy} onRetry={handleRetry} />;
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-describedby={submitAttempted && !formValid ? 'session-form-errors' : undefined}
      className="flex flex-col gap-6"
      data-testid="session-form"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="source-url-input" className="text-sm font-medium text-[var(--color-ink)]">
          Document URL
        </label>
        <input
          id="source-url-input"
          ref={sourceUrlInputRef}
          name="sourceUrl"
          type="url"
          autoComplete="off"
          inputMode="url"
          placeholder="https://example.com/article.md"
          value={form.url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={lockForm}
          aria-invalid={submitAttempted && urlError !== null}
          aria-describedby={submitAttempted && urlError !== null ? 'source-url-error' : undefined}
          data-testid="source-url-input"
          className="min-h-[44px] rounded-md border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] px-3 text-[var(--color-ink)]"
        />
        {submitAttempted && urlError !== null && (
          <p
            id="source-url-error"
            data-testid="source-url-error"
            role="alert"
            className="text-xs text-[var(--color-ink-muted)]"
          >
            {urlError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="topic-input" className="text-sm font-medium text-[var(--color-ink)]">
          Topic hint (optional)
        </label>
        <input
          id="topic-input"
          name="topic"
          type="text"
          maxLength={URL_TOPIC_MAX}
          placeholder="e.g. authentication"
          value={form.topic}
          onChange={(event) => setTopic(event.target.value)}
          disabled={lockForm}
          aria-invalid={submitAttempted && topicError !== null}
          aria-describedby={submitAttempted && topicError !== null ? 'topic-error' : undefined}
          data-testid="topic-input"
          className="min-h-[44px] rounded-md border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] px-3 text-[var(--color-ink)]"
        />
        {submitAttempted && topicError !== null && (
          <p
            id="topic-error"
            data-testid="topic-error"
            role="alert"
            className="text-xs text-[var(--color-ink-muted)]"
          >
            {topicError}
          </p>
        )}
      </div>

      <StrategyPicker
        value={form.strategy}
        onChange={setStrategy}
        disabled={lockForm}
        describedBy={submitAttempted && strategyError !== null ? 'strategy-error' : undefined}
      />
      {submitAttempted && strategyError !== null && (
        <p
          id="strategy-error"
          data-testid="strategy-error"
          role="alert"
          className="text-xs text-[var(--color-ink-muted)]"
        >
          {strategyError}
        </p>
      )}

      <ProviderModelSelect
        providers={liveProviderIds}
        provider={form.provider}
        modelsFor={(p) => modelsForProvider(liveProviders, p)}
        defaultModelFor={(p) => defaultModelForProvider(liveProviders, p)}
        model={form.model}
        onProviderChange={setProvider}
        onModelChange={setModel}
        disabled={lockForm}
      />

      <QuestionCountSelect
        value={form.questionCount}
        onChange={setQuestionCount}
        disabled={lockForm}
      />

      {providersEmpty && (
        <EmptyState
          title="No providers configured."
          body="Set MiniMax or OpenRouter environment variables on the API to enable quiz generation."
        />
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          data-testid="start-button"
          disabled={!formValid || lockForm || providersEmpty}
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[var(--color-primary)] px-5 py-2 text-[var(--color-primary-foreground)] disabled:opacity-50"
        >
          {lockForm ? 'Starting…' : 'Start'}
        </button>
        {submitAttempted && !formValid && (
          <p
            id="session-form-errors"
            data-testid="session-form-errors"
            className="text-xs text-[var(--color-ink-muted)]"
          >
            Fix the highlighted fields before starting.
          </p>
        )}
      </div>

      {lockForm && <NarratedWait stages={GENERATION_STAGES} />}
    </form>
  );
}
