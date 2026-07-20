import type { CategoryPerformanceDto } from '@ai-quiz/shared';
import { describe, expect, it } from 'vitest';

import { buildInsights } from '../../src/domain/submission/services/category-aggregator.service.js';

function category(overrides: Partial<CategoryPerformanceDto>): CategoryPerformanceDto {
  return {
    name: 'General',
    questionCount: 1,
    correctCount: 0,
    avgRawScore: 0,
    weightedScore: 0,
    strength: 'weak',
    ...overrides,
  };
}

describe('buildInsights', () => {
  it('weakCategories only includes strength=weak categories, ranked ascending avgRawScore', () => {
    const breakdown = [
      category({ name: 'Strong Topic', avgRawScore: 3.5, strength: 'strong' }),
      category({ name: 'Weak B', avgRawScore: 1.0, strength: 'weak' }),
      category({ name: 'Weak A', avgRawScore: 0.5, strength: 'weak' }),
      category({ name: 'Mixed Topic', avgRawScore: 2.0, strength: 'mixed' }),
    ];
    const result = buildInsights(breakdown, new Map());
    expect(result.weakCategories).toEqual(['Weak A', 'Weak B']);
  });

  it('topicsToStudy covers exactly the same category set as weakCategories', () => {
    const breakdown = [
      category({ name: 'Weak One', avgRawScore: 1.0, strength: 'weak', questionCount: 2 }),
      category({ name: 'Strong One', avgRawScore: 4.0, strength: 'strong' }),
    ];
    const result = buildInsights(breakdown, new Map([['Weak One', ['a snippet']]]));
    expect(result.topicsToStudy.map((t) => t.topic)).toEqual(result.weakCategories);
    expect(result.topicsToStudy).toHaveLength(1);
    expect(result.topicsToStudy[0]?.docSnippets).toEqual(['a snippet']);
    expect(result.topicsToStudy[0]?.reason).toContain('1.0/4');
    expect(result.topicsToStudy[0]?.reason).toContain('2 questions');
  });

  it('strengthByCategory is a map keyed by every category name, not a scalar', () => {
    const breakdown = [
      category({ name: 'A', strength: 'strong' }),
      category({ name: 'B', strength: 'mixed' }),
      category({ name: 'C', strength: 'weak' }),
    ];
    const result = buildInsights(breakdown, new Map());
    expect(result.strengthByCategory).toEqual({ A: 'strong', B: 'mixed', C: 'weak' });
  });

  it('docSnippets defaults to empty array when no map entry exists for a weak category', () => {
    const breakdown = [category({ name: 'Weak No Snippets', strength: 'weak' })];
    const result = buildInsights(breakdown, new Map());
    expect(result.topicsToStudy[0]?.docSnippets).toEqual([]);
  });

  it('returns empty weakCategories/topicsToStudy when no category is weak', () => {
    const breakdown = [
      category({ name: 'A', strength: 'strong' }),
      category({ name: 'B', strength: 'mixed' }),
    ];
    const result = buildInsights(breakdown, new Map());
    expect(result.weakCategories).toEqual([]);
    expect(result.topicsToStudy).toEqual([]);
  });
});
