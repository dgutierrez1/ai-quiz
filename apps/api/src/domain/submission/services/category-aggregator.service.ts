// apps/api/src/domain/submission/services/category-aggregator.service.ts
//
// Pure, plain-function module (no NestJS decorators — AD-1/AD-2) that turns
// the already-computed `categoryBreakdown` into the submit-time `insights`
// payload (AC #7, #8, #14). No I/O, no LLM, no Tavily.

import { type CategoryPerformanceDto, rankWeakCategories } from '@ai-quiz/shared';

import type { InsightsDto, TopicToStudyDto } from '../dto/submission.schemas.js';

/**
 * Builds the `insights` payload from an already-scored `categoryBreakdown`.
 *
 * - `weakCategories`: names of `strength === 'weak'` categories, in the
 *   order `rankWeakCategories` already produces (ascending avgRawScore, tie
 *   broken ascending name) — filtered, never re-sorted.
 * - `topicsToStudy`: covers exactly the weak categories (same set as
 *   `weakCategories` — a deliberate scope decision, see story Dev Notes).
 * - `strengthByCategory`: a map keyed by every category name (the AC #7 bug
 *   fix — never a single scalar).
 */
export function buildInsights(
  categoryBreakdown: readonly CategoryPerformanceDto[],
  docSnippetsByCategory: ReadonlyMap<string, readonly string[]>,
): InsightsDto {
  const ranked = rankWeakCategories(categoryBreakdown);
  const weak = ranked.filter((category) => category.strength === 'weak');

  const weakCategories = weak.map((category) => category.name);
  const topicsToStudy: TopicToStudyDto[] = weak.map((category) => ({
    topic: category.name,
    reason: `Scored ${category.avgRawScore.toFixed(1)}/4 across ${category.questionCount} question${category.questionCount === 1 ? '' : 's'} in this category.`,
    docSnippets: [...(docSnippetsByCategory.get(category.name) ?? [])],
  }));

  const strengthByCategory = Object.fromEntries(
    categoryBreakdown.map((category) => [category.name, category.strength]),
  );

  return { topicsToStudy, weakCategories, strengthByCategory };
}
