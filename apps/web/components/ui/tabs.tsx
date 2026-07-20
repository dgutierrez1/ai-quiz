'use client';

/**
 * Tabs primitives (Story 3.2 Task 4) — the first consumer of a `Tabs`
 * control in this repo.
 *
 * Deviation from the story's literal instruction ("shadcn Tabs"): no
 * shadcn/Radix package is actually installed in this repo — Story 2.7's
 * landing page built every control (radio group, selects) from plain HTML
 * elements rather than Radix primitives (see `components/landing/
 * strategy-picker.tsx`). This file follows that established convention: a
 * small, dependency-free, WAI-ARIA-compliant tab implementation (roles
 * `tablist`/`tab`/`tabpanel`, roving `tabIndex`, arrow-key navigation) with
 * the exact same external shape a Radix-based version would have had.
 *
 * These are deliberately stateless/presentational — no Context is
 * introduced (the app is contractually limited to exactly two React
 * Contexts: UUID and theme). The active-tab state lives in the caller
 * (`result-page-shell.tsx`), which is plain `useState`, consistent with
 * every other controlled-component pattern already in this codebase.
 */

interface TabsTriggerProps {
  readonly id: string;
  readonly controls: string;
  readonly active: boolean;
  readonly onSelect: () => void;
  readonly testId: string;
  readonly className?: string;
  readonly children: React.ReactNode;
}

export function TabsTrigger({
  id,
  controls,
  active,
  onSelect,
  testId,
  className,
  children,
}: TabsTriggerProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={active}
      aria-controls={controls}
      tabIndex={active ? 0 : -1}
      data-testid={testId}
      onClick={onSelect}
      className={[
        'inline-flex min-h-[44px] items-center rounded-t-[var(--radius-sm)] px-4 text-sm font-medium transition',
        active
          ? 'border-b-2 border-[var(--color-primary)] text-[var(--color-ink)]'
          : 'border-b-2 border-transparent text-[var(--color-ink-muted)]',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

interface TabsContentProps {
  readonly id: string;
  readonly labelledBy: string;
  readonly active: boolean;
  readonly className?: string;
  readonly children: React.ReactNode;
}

/**
 * Always mounted — visibility is a pure CSS toggle on `data-state`, never a
 * conditional unmount. This is what keeps `getByTestId()` inside each panel
 * resolving to exactly one element at every viewport width (Story 3.2 AC
 * #11). Callers pair this with Tailwind classes like
 * `data-[state=inactive]:hidden lg:data-[state=inactive]:block` to scope
 * the hiding to below the `lg` breakpoint only.
 */
export function TabsContent({
  id,
  labelledBy,
  active,
  className,
  children,
}: TabsContentProps): React.JSX.Element {
  return (
    <div
      role="tabpanel"
      id={id}
      aria-labelledby={labelledBy}
      data-state={active ? 'active' : 'inactive'}
      tabIndex={0}
      className={className}
    >
      {children}
    </div>
  );
}
