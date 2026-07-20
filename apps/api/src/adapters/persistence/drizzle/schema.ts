import { desc, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    externalId: text('external_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    externalIdUnique: uniqueIndex('users_external_id_unique').on(table.externalId),
  }),
);

export const quizSessions = pgTable(
  'quiz_sessions',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sourceUrl: text('source_url').notNull(),
    topic: text('topic'),
    strategy: text('strategy').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    status: text('status').notNull(),
    errorMessage: text('error_message'),
    questionCount: integer('question_count').notNull(),
    actualCount: integer('actual_count'),
    selectedCategories: jsonb('selected_categories')
      .$type<string[]>()
      .notNull()
      .default(sql`\'[]\'::jsonb`),
    finalScore: numeric('final_score', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => ({
    userCreatedAtIndex: index('idx_quiz_sessions_user_id_created_at').on(
      table.userId,
      desc(table.createdAt),
    ),
  }),
);

export const documents = pgTable('documents', {
  id: uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => quizSessions.id),
  sourceUrl: text('source_url').notNull(),
  contentMarkdown: text('content_markdown').notNull(),
  chunks: jsonb('chunks').$type<string[]>().notNull(),
  contentHash: text('content_hash').notNull(),
  byteSize: integer('byte_size').notNull(),
  tokenEstimate: integer('token_estimate').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
export const questions = pgTable(
  'questions',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => quizSessions.id),
    position: integer('position').notNull(),
    text: text('text').notNull(),
    type: text('type').notNull(),
    category: text('category').notNull(),
    explanation: text('explanation').notNull(),
  },
  (table) => ({
    positionUnique: uniqueIndex('questions_session_position_unique').on(
      table.sessionId,
      table.position,
    ),
  }),
);
export const answers = pgTable(
  'answers',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id),
    position: integer('position').notNull(),
    text: text('text').notNull(),
    isCorrect: boolean('is_correct').notNull(),
  },
  (table) => ({
    positionUnique: uniqueIndex('answers_question_position_unique').on(
      table.questionId,
      table.position,
    ),
  }),
);
// `correctCount`/`weightedScore` are appended by Story 3.1 (0004 migration).
// Generation (Story 2.6) seeds a skeleton row (sessionId/name/questionCount
// only); SubmitAnswersUseCase is the sole writer of the remaining columns —
// see apps/api/src/adapters/persistence/drizzle/submission.repository.ts.
export const knowledgeCategories = pgTable(
  'knowledge_categories',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => quizSessions.id),
    name: text('name').notNull(),
    questionCount: integer('question_count').notNull(),
    correctCount: integer('correct_count').notNull().default(0),
    avgRawScore: numeric('avg_raw_score', { mode: 'number' }),
    weightedScore: numeric('weighted_score', { mode: 'number' }),
    strength: text('strength'),
  },
  (table) => ({
    nameUnique: uniqueIndex('knowledge_categories_session_name_unique').on(
      table.sessionId,
      table.name,
    ),
  }),
);

// ── Story 3.1 — submit, score & serve results ────────────────────────────────

export const userResponses = pgTable(
  'user_responses',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => quizSessions.id),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id),
    selected: jsonb('selected').$type<number[]>().notNull(),
    rawScore: numeric('raw_score', { mode: 'number' }).notNull(),
    weight: numeric('weight', { mode: 'number' }).notNull(),
    weightedScore: numeric('weighted_score', { mode: 'number' }).notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sessionQuestionUnique: uniqueIndex('user_responses_session_question_unique').on(
      table.sessionId,
      table.questionId,
    ),
  }),
);

export const insights = pgTable('insights', {
  id: uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => quizSessions.id),
  kind: text('kind').notNull().default('gap_analysis'),
  payload: jsonb('payload').notNull(),
  sources: jsonb('sources').$type<string[] | null>(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

// ── Story 4.1/4.4 — chat persistence + 7-day retention scrub ─────────────────
//
// No `question_id` column — chat is fully decoupled from questions (Story
// 4.1 AC #1). `content`/`sources`/`toolCalls`/`thinking` are nullable from
// day one: this story always writes `content` non-null, but Story 4.4's
// scrub job nulls it (+ `sources`/`toolCalls`/`thinking`) in place and sets
// `scrubbedAt`, so declaring the columns nullable now avoids a later
// schema-widening migration. `INDEX (session_id, created_at)` backs the
// keyset (seek) pagination query in `chat.repository.ts` — no LIMIT/OFFSET
// anywhere in that repository.
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id')
      .default(sql`gen_random_uuid()`)
      .primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => quizSessions.id),
    role: text('role').notNull(),
    content: text('content'),
    sources: jsonb('sources').$type<unknown>(),
    toolCalls: jsonb('tool_calls').$type<unknown>(),
    model: text('model'),
    thinking: jsonb('thinking').$type<unknown>(),
    scrubbedAt: timestamp('scrubbed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    sessionCreatedAtIndex: index('idx_chat_messages_session_id_created_at').on(
      table.sessionId,
      table.createdAt,
    ),
  }),
);

export const schema = {
  users,
  quizSessions,
  documents,
  questions,
  answers,
  knowledgeCategories,
  userResponses,
  insights,
  chatMessages,
};
