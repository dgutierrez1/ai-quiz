'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { ApiError } from '../../lib/api';
import { useSessionQuery } from '../../lib/queries';
import type { SubmittedSessionDetail } from '../../lib/types';
import { EmptyState } from '../states/empty-state';
import { ResultPageShell } from './result-page-shell';
import { ResultsPanelSkeleton } from './results-panel-skeleton';

interface ResultPageClientProps {
  readonly sessionId: string;
}

/**
 * ResultPageClient (Story 3.2 Task 1/3) — owns the `GET /api/sessions/:id`
 * query and status branching: loading skeleton, 404 (no chrome), redirect
 * for any non-`submitted` status, and the full dual-panel/tabs shell for
 * `submitted`.
 */
export function ResultPageClient({ sessionId }: ResultPageClientProps): React.JSX.Element {
  const router = useRouter();
  const sessionQuery = useSessionQuery(sessionId);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const session = sessionQuery.data;
  const status = session?.status;

  // Story 3.3 already owns the correct per-status UI at /quiz/[id]
  // (resume ready/pending, error+retry for failed) — this route only ever
  // renders content for `submitted` (AC #5).
  useEffect(() => {
    if (status && status !== 'submitted') {
      router.replace(`/quiz/${sessionId}`);
    }
  }, [status, sessionId, router]);

  // Focus moves to the new surface's <h1> on route entry (Accessibility Floor).
  useEffect(() => {
    if (status === 'submitted' && headingRef.current) {
      headingRef.current.focus();
    }
  }, [status]);

  if (sessionQuery.isLoading) {
    return (
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-12">
        <h1 ref={headingRef} tabIndex={-1} data-testid="result-h1" className="sr-only">
          Your results
        </h1>
        <ResultsPanelSkeleton />
      </main>
    );
  }

  if (sessionQuery.isError) {
    const err = sessionQuery.error;
    const notFound = err instanceof ApiError && err.status === 404;
    return (
      <main id="main" className="mx-auto w-full max-w-[var(--spacing-reading-measure)] px-4 py-12">
        <h1 ref={headingRef} tabIndex={-1} data-testid="result-h1" className="sr-only">
          {notFound ? "This session isn't available." : 'Something went wrong.'}
        </h1>
        <EmptyState
          title={notFound ? "This session isn't available." : 'Something went wrong.'}
          body={
            notFound
              ? 'It may have expired, or it belongs to another browser.'
              : 'Try refreshing the page.'
          }
          testIdPrefix="result-not-found"
        />
      </main>
    );
  }

  if (!session || status !== 'submitted') {
    // Non-submitted statuses redirect via the effect above — a skeleton
    // avoids flashing any broken/empty result content while that happens.
    return (
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-12">
        <h1 ref={headingRef} tabIndex={-1} data-testid="result-h1" className="sr-only">
          Redirecting…
        </h1>
        <ResultsPanelSkeleton />
      </main>
    );
  }

  return (
    <main id="main" className="mx-auto w-full max-w-6xl px-4 py-12">
      <h1 ref={headingRef} tabIndex={-1} data-testid="result-h1" className="mb-6">
        Your results
      </h1>
      <ResultPageShell sessionId={sessionId} session={session as SubmittedSessionDetail} />
    </main>
  );
}
