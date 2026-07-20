import type { SessionInsights } from '../../lib/types';

interface InsightsPanelProps {
  readonly insights: SessionInsights | undefined;
}

/**
 * InsightsPanel (Story 3.2 AC #9) — renders inline, no separate "Analyze
 * gaps" trigger, no insight endpoint call (FR-12/FR-13 removed).
 *
 * `topicsToStudy[]`'s element shape is not pinned upstream (architecture
 * spine Deferred N8) — every field is read defensively; unexpected or
 * missing fields are treated as absent rather than thrown on. Returns
 * `null` (renders nothing) when there is genuinely nothing to show, rather
 * than an empty section.
 */
export function InsightsPanel({ insights }: InsightsPanelProps): React.JSX.Element | null {
  const topics = (insights?.topicsToStudy ?? []).filter(
    (t): t is { topic: string; reason?: string; docSnippets?: readonly string[] } =>
      typeof t?.topic === 'string' && t.topic.length > 0,
  );
  const weak = (insights?.weakCategories ?? []).filter(
    (c): c is string => typeof c === 'string' && c.length > 0,
  );

  if (topics.length === 0 && weak.length === 0) {
    return null;
  }

  return (
    <section
      data-testid="insights-panel"
      aria-label="What to study next"
      className="flex flex-col gap-3 text-[length:var(--text-reading)] text-[var(--color-ink)] [max-width:var(--spacing-reading-measure)]"
    >
      <h2 className="font-display text-[length:var(--text-display)]">What to study next</h2>
      {topics.length > 0 && (
        <ul data-testid="insights-topics" className="flex flex-col gap-2">
          {topics.map((topic, i) => (
            <li key={`${topic.topic}-${i}`} data-testid={`insight-topic-${i}`}>
              <p>{topic.topic}</p>
              {typeof topic.reason === 'string' && topic.reason.length > 0 && (
                <p className="text-[var(--color-ink-muted)]">{topic.reason}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {weak.length > 0 && (
        <p data-testid="insights-weak-categories" className="text-[var(--color-ink-muted)]">
          Weaker categories: {weak.join(', ')}.
        </p>
      )}
    </section>
  );
}
