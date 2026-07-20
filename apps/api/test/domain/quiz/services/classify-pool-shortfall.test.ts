import { describe, expect, it } from 'vitest';

import { classifyShortfall } from '../../../../src/domain/quiz/services/classify-pool-shortfall.js';

describe('classifyShortfall — AD-N4 steps 1-2 (classification only, no retry)', () => {
  it('full: validCount >= questionCount', () => {
    expect(classifyShortfall(8, 2, 8)).toEqual({ outcome: 'full', q: 8 });
    expect(classifyShortfall(12, 4, 8)).toEqual({ outcome: 'full', q: 8 });
  });

  it('boundary: validCount === questionCount is full, not shortfall', () => {
    expect(classifyShortfall(8, 3, 8).outcome).toBe('full');
  });

  it('shortfall: 5 <= validCount < questionCount, carries q = validCount', () => {
    expect(classifyShortfall(6, 2, 8)).toEqual({ outcome: 'shortfall', q: 6 });
    expect(classifyShortfall(7, 3, 8)).toEqual({ outcome: 'shortfall', q: 7 });
  });

  it('boundary: validCount === 5 is shortfall, not regenerate', () => {
    expect(classifyShortfall(5, 2, 8).outcome).toBe('shortfall');
    expect(classifyShortfall(5, 2, 8).q).toBe(5);
  });

  it('regenerate: validCount < 5', () => {
    expect(classifyShortfall(4, 2, 8).outcome).toBe('regenerate');
    expect(classifyShortfall(0, 0, 8).outcome).toBe('regenerate');
  });

  it('boundary: validCount === 4 is regenerate, not shortfall', () => {
    expect(classifyShortfall(4, 4, 8).outcome).toBe('regenerate');
  });

  it('regenerate: fewer than 2 distinct categories, even with a healthy validCount', () => {
    expect(classifyShortfall(12, 1, 8).outcome).toBe('regenerate');
    expect(classifyShortfall(8, 0, 8).outcome).toBe('regenerate');
  });

  it('boundary: distinctCategories === 2 is not regenerate on that basis alone', () => {
    expect(classifyShortfall(8, 2, 8).outcome).toBe('full');
  });
});
