import { describe, expect, it } from 'vitest';

import { selectDocSnippets } from '../../src/domain/submission/services/topic-snippet-matcher.js';

describe('selectDocSnippets', () => {
  it('ranks chunks by token overlap against the query text', () => {
    const chunks = [
      'Postgres row-level security uses policies to restrict rows.',
      'React hooks let you use state in function components.',
      'RLS policies in Postgres can be FORCEd on the table owner role.',
    ];
    const result = selectDocSnippets('postgres row level security policies', chunks, 2);
    expect(result).toHaveLength(2);
    // The two Postgres/RLS chunks should outrank the React chunk.
    expect(result.some((snippet) => snippet.includes('React hooks'))).toBe(false);
  });

  it('is deterministic across repeated calls with the same input', () => {
    const chunks = ['alpha beta gamma', 'delta epsilon zeta', 'alpha delta theta'];
    const first = selectDocSnippets('alpha delta', chunks, 2);
    const second = selectDocSnippets('alpha delta', chunks, 2);
    expect(first).toEqual(second);
  });

  it('never returns empty when chunks is non-empty, even with zero overlap', () => {
    const chunks = ['completely unrelated content here', 'more unrelated filler text'];
    const result = selectDocSnippets('quantum flux capacitor xyz', chunks, 2);
    expect(result.length).toBeGreaterThan(0);
    // Falls back to document order.
    expect(result[0]).toBe(chunks[0]?.slice(0, 300));
  });

  it('returns empty array when chunks is empty', () => {
    expect(selectDocSnippets('anything', [], 2)).toEqual([]);
  });

  it('truncates snippets to snippetMaxChars', () => {
    const longChunk = 'x'.repeat(500);
    const result = selectDocSnippets('x', [longChunk], 1, 300);
    expect(result[0]?.length).toBe(300);
  });

  it('respects the limit parameter', () => {
    const chunks = ['a b c', 'a b d', 'a b e', 'a b f'];
    const result = selectDocSnippets('a b', chunks, 2);
    expect(result).toHaveLength(2);
  });
});
