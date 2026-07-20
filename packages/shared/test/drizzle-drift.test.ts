import { QuizSessionRowSchema, UserRowSchema } from '@ai-quiz/shared';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { quizSessions, users } from '../../../apps/api/src/adapters/persistence/drizzle/schema.js';

describe('Drizzle and Zod row schema drift guard', () => {
  it('keeps users columns aligned with UserRowSchema', () => {
    expect(Object.keys(getTableColumns(users)).sort()).toEqual(
      Object.keys(UserRowSchema.shape).sort(),
    );
  });

  it('keeps quiz session columns aligned with QuizSessionRowSchema', () => {
    expect(Object.keys(getTableColumns(quizSessions)).sort()).toEqual(
      Object.keys(QuizSessionRowSchema.shape).sort(),
    );
  });
});
