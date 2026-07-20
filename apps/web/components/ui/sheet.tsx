'use client';

import { useEffect, useRef } from 'react';

/**
 * Sheet (Story 5.1 Task 7, first consumer) — dependency-free slide-out
 * panel.
 *
 * No Radix/shadcn package is actually installed in this repo — see
 * `ui/tabs.tsx`'s doc comment for the established precedent (Story 2.7
 * built every control from plain HTML/ARIA rather than pulling in Radix).
 * This follows the same convention: a small, WAI-ARIA-compliant dialog
 * with the same external shape a shadcn `Sheet` would have had, fully
 * controlled by the caller's `open` boolean — no internal Context (the
 * app is contractually limited to exactly two React Contexts: UUID and
 * theme; this component doesn't add a third, or any).
 *
 * Behavior (AC #12):
 *   - Renders nothing when `open` is false — this is what guarantees a
 *     consumer mounted only inside `children` (e.g. `HistoryList`) is
 *     never present in the DOM while the sheet is closed.
 *   - Moves focus into the panel on open (first focusable element, or the
 *     panel itself as a fallback).
 *   - Traps Tab/Shift+Tab within the panel while open.
 *   - Closes on `Escape`.
 *   - Restores focus to whatever was focused before opening (the trigger,
 *     in every real usage) when it closes.
 *   - Backdrop click closes, same as Radix's default.
 */

export interface SheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly side?: 'left' | 'right';
  readonly children: React.ReactNode;
  readonly testId?: string;
  readonly ariaLabel: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({
  open,
  onOpenChange,
  side = 'right',
  children,
  testId,
  ariaLabel,
}: SheetProps): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable && focusable.length > 0 ? focusable[0]! : panel)?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChange(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 h-full w-full cursor-default bg-[var(--color-ink)]/40"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        data-testid={testId}
        tabIndex={-1}
        className={[
          'absolute top-0 h-full w-full max-w-sm overflow-y-auto bg-[var(--color-surface-raised)] p-6 shadow-lg outline-none',
          side === 'right' ? 'right-0' : 'left-0',
        ].join(' ')}
      >
        {children}
      </div>
    </div>
  );
}
