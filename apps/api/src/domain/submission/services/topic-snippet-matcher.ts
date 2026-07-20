// apps/api/src/domain/submission/services/topic-snippet-matcher.ts
//
// Pure, deterministic token-overlap matcher that selects the most relevant
// document chunks for a weak category's `topicsToStudy[].docSnippets` (AC
// #14 — no LLM, no Tavily). Conceptually similar to Story 2.4's
// `grounding-check.ts` `isGrounded` (also token-overlap-based) but is a
// separately-authored function to avoid editing a concurrently-authored
// sibling story's file (`apps/api/src/domain/quiz/**`).

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'not',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'what',
  'when',
  'which',
  'why',
  'with',
]);

function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !STOPWORDS.has(token));
  return new Set(tokens);
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Ranks `chunks` by token-overlap (Jaccard) against `categoryQuestionText`
 * and returns the top `limit`, each truncated to `snippetMaxChars`.
 *
 * Never returns an empty array when `chunks` is non-empty: if nothing scores
 * above zero overlap, falls back to the first `limit` chunks in document
 * order so a genuinely weak category never renders a blank snippet list.
 */
export function selectDocSnippets(
  categoryQuestionText: string,
  chunks: readonly string[],
  limit = 2,
  snippetMaxChars = 300,
): string[] {
  if (chunks.length === 0) return [];

  const queryTokens = tokenize(categoryQuestionText);
  const scored = chunks
    .map((chunk, index) => ({ chunk, index, score: jaccard(queryTokens, tokenize(chunk)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index));

  const ordered = scored.length > 0 ? scored.map((entry) => entry.chunk) : [...chunks];
  return ordered.slice(0, limit).map((chunk) => chunk.slice(0, snippetMaxChars));
}
