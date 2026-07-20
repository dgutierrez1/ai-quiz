'use client';

import { useCallback, useState } from 'react';

import type { SubmittedSessionDetail } from '../../lib/types';
import { TabsContent, TabsTrigger } from '../ui/tabs';
import { ChatPanelSlot } from './chat-panel-slot';
import { ResultsPanel } from './results-panel';

interface ResultPageShellProps {
  readonly sessionId: string;
  readonly session: SubmittedSessionDetail;
}

const RESULTS_PANEL_ID = 'result-panel-results';
const CHAT_PANEL_ID = 'result-panel-chat';
const RESULTS_TAB_ID = 'result-tab-results-trigger';
const CHAT_TAB_ID = 'result-tab-chat-trigger';

type TabValue = 'results' | 'chat';
const TAB_ORDER: readonly TabValue[] = ['results', 'chat'];

/**
 * ResultPageShell (Story 3.2 Task 4) — single-mount dual-panel/tabs
 * responsive shell.
 *
 * `lg` (1024px) is the ONLY structural breakpoint here — Tailwind's
 * built-in `lg:` variant only, no `md:` classes, no arbitrary pixel
 * variants, no JS `matchMedia`/viewport-detection hook anywhere (AC #2).
 *
 * `ResultsPanel` and `ChatPanelSlot` each mount EXACTLY ONCE, always —
 * never as two separate JSX subtrees for "mobile tabs" vs "desktop grid"
 * (AC #11). Visibility below `lg` is a pure CSS toggle on `data-state`
 * (`data-[state=inactive]:hidden`), overridden back to visible at `lg:`
 * (`lg:data-[state=inactive]:block`) so both panels show simultaneously
 * in the desktop grid regardless of which tab is "active". This is the
 * `forceMount` + `data-state` pattern from the story's Dev Notes, done
 * without a Radix dependency (see `components/ui/tabs.tsx`).
 *
 * Story 4.3 adds the `pendingPrefill` lifted state for the "Explain Qn"
 * flow (AD-17: exactly two React Contexts exist — UUID, theme — a third
 * is not introduced here; this is plain `useState` threaded via props to
 * both `ExplainQuestionButton` and `ChatPanel`, per the Story 4.3 chat
 * slot contract). `handleExplain` unconditionally sets `active` to
 * `'chat'` rather than checking the viewport with `matchMedia`: at `lg`+,
 * `TabsContent`'s `lg:data-[state=inactive]:block` override already keeps
 * both panels visible regardless of `data-state`, so switching the tab is
 * a no-op there and the correct "switch to Chat tab first" behavior below
 * `lg` (EXPERIENCE.md) falls out for free, with no JS viewport-detection
 * hook needed.
 */
export function ResultPageShell({ sessionId, session }: ResultPageShellProps): React.JSX.Element {
  const [active, setActive] = useState<TabValue>('results');
  const [pendingPrefill, setPendingPrefill] = useState<string | null>(null);

  const handleExplain = useCallback((text: string) => {
    setPendingPrefill(text);
    setActive('chat');
  }, []);

  const handlePrefillConsumed = useCallback(() => {
    setPendingPrefill(null);
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const isArrow = event.key === 'ArrowRight' || event.key === 'ArrowLeft';
    const isEdge = event.key === 'Home' || event.key === 'End';
    if (!isArrow && !isEdge) return;
    event.preventDefault();
    if (event.key === 'Home') {
      setActive('results');
      return;
    }
    if (event.key === 'End') {
      setActive('chat');
      return;
    }
    const idx = TAB_ORDER.indexOf(active);
    const nextIdx =
      event.key === 'ArrowRight'
        ? (idx + 1) % TAB_ORDER.length
        : (idx - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    const next = TAB_ORDER[nextIdx];
    if (next) setActive(next);
  };

  return (
    <div
      data-testid="result-page-shell"
      className="lg:grid lg:grid-cols-[minmax(0,58fr)_minmax(0,42fr)] lg:items-start lg:gap-[length:var(--spacing-panel-gutter)]"
    >
      <div
        role="tablist"
        aria-label="Result sections"
        data-testid="result-tabs-list"
        onKeyDown={handleKeyDown}
        className="sticky top-0 z-10 mb-4 flex gap-2 border-b border-[var(--color-surface-sunken)] bg-[var(--color-surface-base)] pt-1 lg:hidden"
      >
        <TabsTrigger
          id={RESULTS_TAB_ID}
          controls={RESULTS_PANEL_ID}
          active={active === 'results'}
          onSelect={() => setActive('results')}
          testId="result-tab-results"
        >
          Results
        </TabsTrigger>
        <TabsTrigger
          id={CHAT_TAB_ID}
          controls={CHAT_PANEL_ID}
          active={active === 'chat'}
          onSelect={() => setActive('chat')}
          testId="result-tab-chat"
        >
          Chat
        </TabsTrigger>
      </div>

      <TabsContent
        id={RESULTS_PANEL_ID}
        labelledBy={RESULTS_TAB_ID}
        active={active === 'results'}
        className="data-[state=inactive]:hidden lg:data-[state=inactive]:block"
      >
        <ResultsPanel session={session} onExplain={handleExplain} />
      </TabsContent>

      <TabsContent
        id={CHAT_PANEL_ID}
        labelledBy={CHAT_TAB_ID}
        active={active === 'chat'}
        className="data-[state=inactive]:hidden lg:sticky lg:top-6 lg:data-[state=inactive]:block"
      >
        <ChatPanelSlot
          sessionId={sessionId}
          pendingPrefill={pendingPrefill}
          onPrefillConsumed={handlePrefillConsumed}
        />
      </TabsContent>
    </div>
  );
}
