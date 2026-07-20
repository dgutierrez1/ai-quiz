'use client';

import type { QuestionType } from '@ai-quiz/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError } from '../../lib/api';
import { type ErrorCopy, errorCopyFor } from '../../lib/error-copy';
import { useSessionQuery, useSubmitAnswersMutation } from '../../lib/queries';
import type { ReadySessionDetail, SubmitAnswersRequest } from '../../lib/types';
import { EmptyState } from '../states/empty-state';
import { ErrorState } from '../states/error-state';
import { NarratedWait, type NarratedWaitStage } from '../states/narrated-wait';
import { RateLimitedState } from '../states/rate-limited-state';
import { Skeleton } from '../ui/skeleton';
import { ProgressIndicator } from './progress-indicator';
import { QuestionCard } from './question-card';
import { QuizPendingState } from './quiz-pending-state';
import { ShortfallNote } from './shortfall-note';

const SUBMIT_STAGES: readonly NarratedWaitStage[] = [
  { atMs: 0, text: 'Scoring your answers…' },
  { atMs: 4000, text: 'Working out where the gaps are…' },
];

interface QuizRunnerProps {
  readonly sessionId: string;
}

/**
 * QuizRunner (Story 3.3) — `'use client'`; owns the `GET /api/sessions/:id`
 * query, status branching, and the answer-taking UI when `status ===
 * 'ready'`.
 *
 * Answer state lives here as plain `useState` — `Record<questionId,
 * selectedPositions[]>` + `currentIndex` — deliberately NOT a new React
 * Context (AD-17/NFR-5: exactly two Contexts exist app-wide: UUID, theme).
 */
export function QuizRunner({ sessionId }: QuizRunnerProps): React.JSX.Element {
  const router = useRouter();
  const sessionQuery = useSessionQuery(sessionId);
  const submitMutation = useSubmitAnswersMutation(sessionId);

  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [selected, setSelected] = useState<Record<string, readonly number[]>>({});
  const [submitErrorCopy, setSubmitErrorCopy] = useState<ErrorCopy | null>(null);
  const [submitRateLimitSeconds, setSubmitRateLimitSeconds] = useState<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const session = sessionQuery.data;
  const status = session?.status;

  // `submitted` → /result/[id]. Navigation happens in an effect, never
  // during render, and never re-fires a submit on back-navigation (this
  // component never calls the submit mutation on mount).
  useEffect(() => {
    if (status === 'submitted') {
      router.replace(`/result/${sessionId}`);
    }
  }, [status, sessionId, router]);

  const questions = useMemo<ReadySessionDetail['questions']>(() => {
    if (status !== 'ready' || !session) return [];
    return (session as ReadySessionDetail).questions;
  }, [status, session]);

  const currentQuestion = questions[currentIndex];

  // Focus moves to the question text on every advance (Task 5 / EXPERIENCE.md).
  useEffect(() => {
    if (status === 'ready' && headingRef.current) {
      headingRef.current.focus();
    }
  }, [currentIndex, status]);

  const toggleSelection = useCallback(
    (questionId: string, position: number, type: QuestionType) => {
      setSelected((prev) => {
        if (type === 'single') {
          return { ...prev, [questionId]: [position] };
        }
        const current = prev[questionId] ?? [];
        const next = current.includes(position)
          ? current.filter((p) => p !== position)
          : [...current, position];
        return { ...prev, [questionId]: next };
      });
    },
    [],
  );

  const isAnswered = useCallback(
    (questionId: string) => (selected[questionId]?.length ?? 0) >= 1,
    [selected],
  );

  // Every question must have >=1 selection before Submit is reachable —
  // computed fresh (not just "current question answered") so that
  // deselecting a `multiple` question's last checkbox after navigating
  // past it can never leave Submit enabled (AC #4/#6, AD-N5).
  const allAnswered = useMemo(
    () => questions.length > 0 && questions.every((q) => isAnswered(q.id)),
    [questions, isAnswered],
  );

  const currentAnswered = currentQuestion ? isAnswered(currentQuestion.id) : false;
  const isLastQuestion = questions.length > 0 && currentIndex === questions.length - 1;

  const goPrevious = useCallback(() => {
    setCurrentIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(questions.length - 1, i + 1));
  }, [questions.length]);

  const handleSubmit = useCallback(() => {
    // Defensive invariant (Task 6): the UI gate above should make this
    // unreachable, but the server is the real authority (AD-N5) — never
    // trust the client gate silently.
    if (!allAnswered) return;
    setSubmitErrorCopy(null);
    setSubmitRateLimitSeconds(null);
    const request: SubmitAnswersRequest = {
      responses: questions.map((q) => ({
        questionId: q.id,
        selected: selected[q.id] ?? [],
      })),
    };
    submitMutation.mutate(
      { request },
      {
        onSuccess: () => {
          router.push(`/result/${sessionId}`);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 429 && typeof err.retryAfter === 'number') {
            setSubmitRateLimitSeconds(err.retryAfter);
            return;
          }
          if (err instanceof ApiError && err.status === 409) {
            // The session wasn't `ready` any more (pending/failed) — the
            // 200-idempotent-replay path never reaches here. Re-fetch so
            // the status-branch logic below picks up the real state.
            void sessionQuery.refetch();
            return;
          }
          setSubmitErrorCopy(errorCopyFor(err));
        },
      },
    );
  }, [allAnswered, questions, selected, submitMutation, router, sessionId, sessionQuery]);

  const handleRetrySubmit = useCallback(() => {
    handleSubmit();
  }, [handleSubmit]);

  // ── Status branches ──────────────────────────────────────────────────

  if (sessionQuery.isLoading) {
    return (
      <main
        id="main"
        className="mx-auto flex min-h-screen w-full max-w-[var(--spacing-reading-measure)] flex-col gap-6 px-4 py-12"
      >
        <h1 className="sr-only">Loading your quiz.</h1>
        <div data-testid="quiz-loading-skeleton" className="flex flex-col gap-6">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-full" />
          <div className="flex flex-col gap-[var(--spacing-option-gap)]">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </main>
    );
  }

  if (sessionQuery.isError) {
    const err = sessionQuery.error;
    const notFound = err instanceof ApiError && err.status === 404;
    if (notFound) {
      return (
        <main
          id="main"
          className="mx-auto flex min-h-screen w-full max-w-[var(--spacing-reading-measure)] flex-col gap-6 px-4 py-12"
        >
          <h1 className="sr-only">This session isn&apos;t available.</h1>
          <EmptyState
            title="This session isn't available."
            body="It may have expired, or it belongs to another browser."
            testIdPrefix="quiz-not-found"
          />
        </main>
      );
    }
    return (
      <main
        id="main"
        className="mx-auto flex min-h-screen w-full max-w-[var(--spacing-reading-measure)] flex-col gap-6 px-4 py-12"
      >
        <h1 className="sr-only">We could not load this quiz.</h1>
        <ErrorState
          copy={errorCopyFor(err)}
          onRetry={() => void sessionQuery.refetch()}
          testIdPrefix="quiz-error"
        />
      </main>
    );
  }

  if (!session || status === 'submitted') {
    // `submitted` redirects via the effect above — render a neutral
    // loading placeholder rather than any quiz content while that happens.
    return (
      <main
        id="main"
        className="mx-auto flex min-h-screen w-full max-w-[var(--spacing-reading-measure)] flex-col gap-6 px-4 py-12"
      >
        <h1 className="sr-only">Loading your quiz.</h1>
        <div data-testid="quiz-loading-skeleton" className="flex flex-col gap-6">
          <Skeleton className="h-8 w-full" />
        </div>
      </main>
    );
  }

  if (status === 'failed') {
    return (
      <main
        id="main"
        className="mx-auto flex min-h-screen w-full max-w-[var(--spacing-reading-measure)] flex-col gap-6 px-4 py-12"
      >
        <h1 className="sr-only">We could not build a quiz from this document.</h1>
        <ErrorState
          copy={{
            title: 'We could not build a quiz from this document.',
            body:
              session.errorMessage ?? 'Retry — if it keeps happening, try a different document.',
          }}
          onRetry={() => router.push('/')}
          testIdPrefix="quiz-failed"
        />
      </main>
    );
  }

  if (status === 'pending') {
    return (
      <main
        id="main"
        className="mx-auto flex min-h-screen w-full max-w-[var(--spacing-reading-measure)] flex-col gap-6 px-4 py-12"
      >
        <QuizPendingState onRefresh={() => void sessionQuery.refetch()} />
      </main>
    );
  }

  // status === 'ready' from here on.

  if (submitRateLimitSeconds !== null) {
    return (
      <main
        id="main"
        className="mx-auto flex min-h-screen w-full max-w-[var(--spacing-reading-measure)] flex-col gap-6 px-4 py-12"
      >
        <h1 className="sr-only">You are going a bit fast.</h1>
        <RateLimitedState
          retryAfterSeconds={submitRateLimitSeconds}
          onElapsed={() => setSubmitRateLimitSeconds(null)}
          testIdPrefix="submit-rate-limited"
        />
      </main>
    );
  }

  if (submitErrorCopy) {
    return (
      <main
        id="main"
        className="mx-auto flex min-h-screen w-full max-w-[var(--spacing-reading-measure)] flex-col gap-6 px-4 py-12"
      >
        <h1 className="sr-only">{submitErrorCopy.title}</h1>
        <ErrorState
          copy={submitErrorCopy}
          onRetry={handleRetrySubmit}
          testIdPrefix="submit-error"
        />
      </main>
    );
  }

  if (!currentQuestion) {
    return (
      <main
        id="main"
        className="mx-auto flex min-h-screen w-full max-w-[var(--spacing-reading-measure)] flex-col gap-6 px-4 py-12"
      >
        <h1 className="sr-only">This quiz has no questions.</h1>
        <EmptyState
          title="This quiz has no questions."
          body="Try starting a new session from the homepage."
          testIdPrefix="quiz-empty"
        />
      </main>
    );
  }

  const showShortfall =
    currentIndex === 0 &&
    typeof session.actualCount === 'number' &&
    typeof session.questionCount === 'number' &&
    session.actualCount < session.questionCount;

  const locked = submitMutation.isPending;
  const nextDisabled = isLastQuestion ? !allAnswered : !currentAnswered;

  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen w-full max-w-[var(--spacing-reading-measure)] flex-col gap-6 px-4 py-12"
    >
      {showShortfall && session.actualCount != null && session.questionCount != null && (
        <ShortfallNote actualCount={session.actualCount} questionCount={session.questionCount} />
      )}

      <ProgressIndicator current={currentIndex + 1} total={questions.length} />

      {/* One announcement per question-advance change (Accessibility Floor). */}
      <div aria-live="polite" className="sr-only">
        {`Question ${currentIndex + 1} of ${questions.length}`}
      </div>

      <QuestionCard
        question={currentQuestion}
        selected={selected[currentQuestion.id] ?? []}
        disabled={locked}
        onToggle={(position) => toggleSelection(currentQuestion.id, position, currentQuestion.type)}
        headingRef={headingRef}
      />

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          data-testid="quiz-previous-button"
          onClick={goPrevious}
          disabled={currentIndex === 0 || locked}
          className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-surface-sunken)] px-4 py-2 text-[var(--color-ink)] disabled:opacity-50"
        >
          Previous
        </button>
        <button
          type="button"
          data-testid="quiz-next-button"
          onClick={isLastQuestion ? handleSubmit : goNext}
          disabled={nextDisabled || locked}
          className="inline-flex min-h-[44px] items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-5 py-2 text-[var(--color-primary-foreground)] disabled:opacity-50"
        >
          {isLastQuestion ? 'Submit' : 'Next'}
        </button>
      </div>

      {locked && <NarratedWait stages={SUBMIT_STAGES} testIdPrefix="submit-wait" />}
    </main>
  );
}
