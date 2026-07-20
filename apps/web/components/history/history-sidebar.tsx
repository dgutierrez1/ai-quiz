'use client';

import { useState } from 'react';

import { Sheet } from '../ui/sheet';
import { HistoryList } from './history-list';

interface HistorySidebarProps {
  readonly onRetry: (sourceUrl: string) => void;
}

/**
 * HistorySidebar (Story 5.1 Task 7) — persistent panel at `lg`+ (1024px),
 * slide-out sheet below it. `lg` is the ONLY structural breakpoint here —
 * Tailwind's built-in `lg:` variant only, no `md:` classes on this shell,
 * no arbitrary pixel variants, no JS `matchMedia`/viewport-detection hook
 * (AC #3, AD-21).
 *
 * Single-mount guarantee (AC #11): `HistoryList` must exist in the DOM
 * exactly once at any moment, or Playwright's `getByTestId` hits a
 * strict-mode violation once Story 5.2 writes a POM against this
 * component. A pure-CSS `hidden`/`lg:block` toggle on the `<aside>` alone
 * does NOT solve this — `hidden` is `display:none`, so the element (and
 * every `data-testid` inside it) stays in the DOM. Instead this gates on
 * the same `mobileOpen` boolean that drives the sheet:
 *   - The `<aside>` only renders `HistoryList` when `!mobileOpen`.
 *   - `Sheet` itself renders nothing (not even its children) while closed
 *     (see `ui/sheet.tsx`), so the sheet's `HistoryList` never mounts
 *     until the sheet opens.
 * At `>= lg` the trigger that could set `mobileOpen = true` is
 * `lg:hidden` — unreachable — so `mobileOpen` can never become `true`
 * there: the aside always renders its copy, the sheet never opens. Below
 * `lg`, opening the sheet mounts the sheet's copy and simultaneously
 * unmounts the aside's — still exactly one, at every instant. `mobileOpen`
 * starts `false` identically on server and client and only ever changes
 * via a real click on a button unreachable at `>= lg`, so there is no
 * hydration-mismatch risk (no viewport-detection JS anywhere in this
 * file).
 */
export function HistorySidebar({ onRetry }: HistorySidebarProps): React.JSX.Element {
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        data-testid="history-sheet-trigger"
        onClick={() => setMobileOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={mobileOpen}
        className="inline-flex min-h-[44px] items-center justify-center self-start rounded-[var(--radius-md)] border border-[var(--color-surface-sunken)] px-4 text-sm font-medium text-[var(--color-ink)] lg:hidden"
      >
        History
      </button>

      <aside
        aria-label="Session history"
        data-testid="history-sidebar-panel"
        className="hidden lg:block"
      >
        <h2 className="mb-4 font-display text-[length:var(--text-question)] text-[var(--color-ink)]">
          History
        </h2>
        {!mobileOpen && <HistoryList onRetry={onRetry} />}
      </aside>

      <Sheet
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        side="right"
        testId="history-sidebar-sheet"
        ariaLabel="Session history"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-[length:var(--text-question)] text-[var(--color-ink)]">
            History
          </h2>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close history"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-md)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-sunken)]"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <HistoryList onRetry={onRetry} />
      </Sheet>
    </div>
  );
}
