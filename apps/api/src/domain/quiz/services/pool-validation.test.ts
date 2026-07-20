import type { GeneratedQuestionDto } from '@ai-quiz/shared';
import { describe, expect, it } from 'vitest';

import { hasNovelSecret, isGrounded } from './pool-validation.js';

const question: GeneratedQuestionDto = {
  text: 'What is the capital of France?',
  type: 'single',
  category: 'geography',
  explanation: 'Paris is the capital.',
  answers: [
    { position: 0, text: 'Paris', isCorrect: true },
    { position: 1, text: 'London', isCorrect: false },
    { position: 2, text: 'Berlin', isCorrect: false },
    { position: 3, text: 'Madrid', isCorrect: false },
  ],
};

describe('pool-validation', () => {
  it('passes grounded questions', () => {
    expect(isGrounded(question, ['Paris is the capital of France'])).toBe(true);
  });
  it('flags ungrounded questions', () => {
    expect(isGrounded(question, ['Cucumbers are green vegetables.'])).toBe(false);
  });
  it('detects novel secrets not in source', () => {
    expect(
      hasNovelSecret({ ...question, explanation: 'key=sk-abcdefghijklmnopqrstuv' }, 'no secrets'),
    ).toBe(true);
  });
  it('accepts secrets already in source', () => {
    expect(hasNovelSecret(question, 'Paris is the capital.')).toBe(false);
  });
});
