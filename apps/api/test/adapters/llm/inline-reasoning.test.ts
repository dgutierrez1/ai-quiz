import { describe, expect, it } from 'vitest';

import { extractJsonPayload, splitInlineReasoning } from '../../../src/adapters/llm/llm.adapter.js';

/**
 * Regression tests for a defect found by driving the real UI against a live
 * MiniMax-M3 key: the model returns its chain-of-thought INLINE inside
 * `message.content` as a `<think>` block, and the chat panel rendered it
 * verbatim — showing the user the model's internal monologue.
 */
describe('splitInlineReasoning (chat path)', () => {
  it('moves a <think> block out of the visible answer', () => {
    const raw =
      '<think>The user just finished a quiz. Let me analyze the gap analysis.</think>\n\n' +
      'Focus on Debugging Tools first — you scored 0/4 there.';

    const { content, thinking } = splitInlineReasoning(raw);

    expect(content).toBe('Focus on Debugging Tools first — you scored 0/4 there.');
    expect(content).not.toContain('Let me analyze');
    expect(thinking).toContain('Let me analyze the gap analysis.');
  });

  it('captures an UNTERMINATED <think> block rather than leaking it', () => {
    // A truncated response is exactly when the closing tag goes missing, and
    // it is also exactly when leaking would be most confusing.
    const { content, thinking } = splitInlineReasoning(
      'Here is the plan.<think>Actually wait, let me reconsider the scoring',
    );

    expect(content).toBe('Here is the plan.');
    expect(thinking).toContain('let me reconsider');
  });

  it('handles multiple blocks and leaves ordinary answers untouched', () => {
    const multi = splitInlineReasoning('<think>one</think>A<think>two</think>B');
    expect(multi.content).toBe('AB');
    expect(multi.thinking).toBe('one\n\ntwo');

    const plain = splitInlineReasoning('Just a normal answer.');
    expect(plain.content).toBe('Just a normal answer.');
    expect(plain.thinking).toBeUndefined();
  });

  it('returns null content when the response was reasoning only', () => {
    const { content, thinking } = splitInlineReasoning('<think>only thinking</think>');
    expect(content).toBeNull();
    expect(thinking).toBe('only thinking');
  });

  it('passes null through', () => {
    expect(splitInlineReasoning(null)).toEqual({ content: null, thinking: undefined });
  });
});

/**
 * Sibling defect on the generation path: the same `<think>` prefix made
 * `JSON.parse` throw on otherwise-valid structured output, burning a retry.
 */
describe('extractJsonPayload (generation path)', () => {
  it('strips a <think> prefix before the JSON object', () => {
    const raw = '<think>planning the questions</think>\n{"questions":[]}';
    expect(JSON.parse(extractJsonPayload(raw))).toEqual({ questions: [] });
  });

  it('unwraps a markdown-fenced JSON payload', () => {
    expect(JSON.parse(extractJsonPayload('```json\n{"questions":[]}\n```'))).toEqual({
      questions: [],
    });
  });

  it('recovers the object when prose surrounds it', () => {
    expect(JSON.parse(extractJsonPayload('Sure! {"questions":[]} hope that helps'))).toEqual({
      questions: [],
    });
  });

  it('leaves clean JSON untouched', () => {
    expect(extractJsonPayload('{"questions":[]}')).toBe('{"questions":[]}');
  });
});
