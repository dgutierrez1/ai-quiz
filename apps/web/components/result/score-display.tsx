'use client';

import { animate, useMotionValue, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

interface ScoreDisplayProps {
  readonly value: number;
  readonly testId?: string;
}

/**
 * ScoreDisplay — `{typography.score}` (Story 3.2 AC #6, DESIGN.md § Score
 * display).
 *
 * Animated count-up (~800ms ease-out) via `motion/react` — "the one
 * genuinely expressive moment in the product" (EXPERIENCE.md). Neutral
 * `{colors.ink}`, NEVER a strength color: the number is neutral by design,
 * the categories carry the diagnosis.
 *
 * `prefers-reduced-motion` renders the final value immediately with no
 * animation, per `useReducedMotion()` (motion/react) rather than a
 * hand-rolled `matchMedia` hook.
 */
export function ScoreDisplay({
  value,
  testId = 'score-display',
}: ScoreDisplayProps): React.JSX.Element {
  const prefersReducedMotion = useReducedMotion();
  const motionValue = useMotionValue(prefersReducedMotion ? value : 0);
  const [display, setDisplay] = useState<number>(prefersReducedMotion ? value : 0);

  useEffect(() => {
    if (prefersReducedMotion) {
      motionValue.set(value);
      setDisplay(value);
      return;
    }
    const controls = animate(motionValue, value, {
      duration: 0.8,
      ease: 'easeOut',
      onUpdate: (latest) => setDisplay(latest),
    });
    return () => controls.stop();
  }, [value, prefersReducedMotion, motionValue]);

  return (
    <p
      data-testid={testId}
      aria-label={`Final score ${value.toFixed(2)} out of 4`}
      className="font-score text-[length:var(--text-score)] leading-[1] tracking-[-0.02em] text-[var(--color-ink)]"
    >
      {display.toFixed(2)}
      <span className="text-[length:var(--text-reading)] text-[var(--color-ink-muted)]"> / 4</span>
    </p>
  );
}
