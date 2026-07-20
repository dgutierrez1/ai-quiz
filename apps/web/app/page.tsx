'use client';

import { useCallback, useState } from 'react';

import { HistorySidebar } from '../components/history/history-sidebar';
import { SessionForm } from '../components/landing/session-form';

/**
 * LandingPage (Story 2.7; two-pane layout + history sidebar added by
 * Story 5.1 Tasks 6/7).
 *
 * This page owns `prefillUrl` — the one piece of shared state a `failed`
 * history row's retry button needs to reach `SessionForm`'s URL field.
 * It is plain `useState` in this client component, not a third React
 * Context (AD-17 caps the app at exactly two: UUID and theme).
 *
 * `lg` (1024px, Tailwind's built-in token) is the only structural
 * breakpoint for the two-pane grid — `HistorySidebar` handles its own
 * internal persistent-panel-vs-sheet collapse at the same boundary.
 */
export default function LandingPage(): React.JSX.Element {
  const [prefillUrl, setPrefillUrl] = useState<string | undefined>(undefined);

  const handleRetry = useCallback((sourceUrl: string) => {
    setPrefillUrl(sourceUrl);
  }, []);

  const handlePrefillConsumed = useCallback(() => {
    setPrefillUrl(undefined);
  }, []);

  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col gap-8 px-4 py-12 md:px-8 md:py-16"
    >
      <header className="flex max-w-[var(--spacing-reading-measure)] flex-col gap-2">
        <h1 data-testid="landing-h1" className="font-display text-[length:var(--text-display)]">
          Turn any document into a quiz.
        </h1>
        <p
          data-testid="landing-subtitle"
          className="max-w-[var(--spacing-reading-measure)] text-[length:var(--text-reading)] text-[var(--color-ink-muted)]"
        >
          Paste a public document URL, pick a strategy, and start. The questions stay grounded in
          what the document actually says.
        </p>
      </header>

      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-[length:var(--spacing-panel-gutter)]">
        <section className="w-full max-w-[var(--spacing-reading-measure)]">
          <SessionForm prefillUrl={prefillUrl} onPrefillConsumed={handlePrefillConsumed} />
        </section>
        <HistorySidebar onRetry={handleRetry} />
      </div>
    </main>
  );
}
