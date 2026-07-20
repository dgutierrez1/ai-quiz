'use client';

import { useEffect, useState } from 'react';

export interface NarratedWaitStage {
  /** Milliseconds at which this stage's copy should appear. */
  readonly atMs: number;
  /** User-facing copy for this stage. */
  readonly text: string;
}

const STAGE_FALLBACK = { atMs: 0, text: '' } as const;

interface NarratedWaitProps {
  /** Stages in display order. The last stage is held until unmount. */
  readonly stages: readonly NarratedWaitStage[];
  /** data-testid prefix used on the wrapper + each stage element. */
  readonly testIdPrefix?: string;
}

/**
 * NarratedWait — generic, reusable staged wait surface (Story 2.7 AC #8).
 *
 * Stages advance forward-only on a client timer. The component NEVER
 * resets and NEVER loops — a looping animation reads as hung. The final
 * stage is held until the component unmounts.
 *
 * `prefers-reduced-motion` is honored by `globals.css` (animation
 * duration = 0); the stage copy itself still advances, because it is
 * information, not decoration.
 *
 * Story 3.1 reuses this component for submit-narration with different
 * stage copy/timings — the props surface is intentionally generic.
 */
export function NarratedWait({
  stages,
  testIdPrefix = 'wait',
}: NarratedWaitProps): React.JSX.Element {
  const [activeIndex, setActiveIndex] = useState<number>(0);

  useEffect(() => {
    if (stages.length === 0) return;
    // Schedule each stage's transition at its atMs boundary. We schedule
    // forward only — never rewind.
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i < stages.length; i += 1) {
      const cur = stages[i];
      const prev = stages[i - 1];
      if (!cur || !prev) continue;
      const delta = cur.atMs - prev.atMs;
      if (delta <= 0) {
        setActiveIndex(i);
        continue;
      }
      timers.push(setTimeout(() => setActiveIndex(i), delta));
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [stages]);

  const activeStage = stages[activeIndex] ?? stages[stages.length - 1] ?? STAGE_FALLBACK;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid={`${testIdPrefix}-root`}
      className="rounded-md border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] p-6"
    >
      <p
        data-testid={`${testIdPrefix}-stage`}
        className="text-[length:var(--text-reading)] text-[var(--color-ink)]"
      >
        {activeStage?.text ?? ''}
      </p>
    </div>
  );
}
