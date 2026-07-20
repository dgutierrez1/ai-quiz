// apps/web/e2e/fixtures/seed-session.ts
//
// Standalone Node module (Story 5.2 Task 3) that seeds a `ready`-status
// quiz session DIRECTLY into Postgres using the raw `pg` package — no
// Drizzle import, keeping this story's fixtures independent of
// `apps/api`'s internal module graph, and no live LLM call anywhere in
// this suite's CI-gating specs (Dev Notes → LLM-avoidance strategy #1).
//
// CRITICAL (AC #13): every owned table is under FORCE ROW LEVEL SECURITY
// (`apps/api/drizzle/0001_session_rls.sql` onward — see
// `current_session_user_id()` + the `user_owns_session`/`user_documents`/
// `user_questions`/`user_answers`/`user_categories` policies). Writes here
// go through the EXACT `SELECT set_config('app.user_id', $1, true)`
// transaction-scoped pattern `apps/api/src/driving/middleware/
// identity.interceptor.ts` uses — never a superuser bypass, never a
// disabled-RLS connection. `true` (the third `set_config` argument) means
// "local to this transaction", matching the interceptor's semantics
// exactly. Without this, every insert below would silently affect 0 rows
// (RLS's `WITH CHECK` clause rejects them) rather than throwing — that
// silent-0-rows failure mode is exactly why this pattern is mandatory, not
// optional.
//
// Each test seeds its OWN fresh session (fresh UUID per call) — Playwright
// runs spec files in parallel workers by default, and sharing one row
// across tests risks races on `user_responses`'s
// `UNIQUE(session_id, question_id)` constraint or on submit's atomic-UPDATE
// mutex (Task 3's own instruction).

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { geometricWeights, scoreQuestion, weightedFinalScore } from '@ai-quiz/shared';
import { Client } from 'pg';

import { FIXTURE_QUESTION_POOL } from './question-pool';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL =
  process.env['E2E_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';

const FIXTURE_DOC_PATH = resolve(__dirname, './fixture-doc.md');
const FIXTURE_SOURCE_URL = 'https://example.test/fixtures/sourdough-guide.md';

export interface SeededQuestion {
  readonly questionId: string;
  readonly category: string;
  readonly type: 'single' | 'multiple';
  readonly position: number;
  readonly text: string;
  /** Positions the QuizPage POM clicks to reproduce the fixture's designed category strengths. */
  readonly selectPositions: readonly number[];
}

export interface SeededSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly questions: readonly SeededQuestion[];
  /**
   * The final score the real scoring engine (`packages/shared/src/
   * scoring.ts`, Story 1.2) computes for this exact fixture — same math
   * the backend's `submitAnswers` use-case runs. Provided as a
   * cross-check for assertions, not as a second source of truth (the
   * actual submit response is still what the spec asserts against).
   */
  readonly expectedFinalScore: number;
}

function readFixtureDoc(): string {
  return readFileSync(FIXTURE_DOC_PATH, 'utf8');
}

/** Splits the fixture doc into per-`##`-section chunks — a stand-in for real chunking (Epic 2's job), just enough for `documents.chunks` to be non-trivial and topically coherent. */
function chunkFixtureDoc(markdown: string): string[] {
  return markdown
    .split(/\n(?=## )/)
    .map((section) => section.trim())
    .filter((section) => section.length > 0);
}

async function withUserTransaction<T>(
  externalId: string,
  fn: (client: Client, userId: string) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');

    // Race-safe upsert mirroring identity.interceptor.ts's
    // onConflictDoUpdate idiom (Story 1.4), even though no concurrency
    // exists here — one external id per seeded session.
    const userRows = await client.query<{ id: string }>(
      `INSERT INTO users (external_id) VALUES ($1)
       ON CONFLICT (external_id) DO UPDATE SET external_id = EXCLUDED.external_id
       RETURNING id`,
      [externalId],
    );
    const userId = userRows.rows[0]?.id;
    if (!userId) throw new Error('seed-session: user upsert returned no row');

    // See module doc — this is the load-bearing RLS line.
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);

    const result = await fn(client, userId);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/**
 * Seeds a complete `ready`-status session (session + document + questions +
 * answers + skeleton `knowledge_categories` rows, mirroring what real
 * generation — Story 2.6 — leaves before submit) for `userExternalId`
 * (the browser-generated UUID a test will also write into `localStorage`
 * via `base-page.ts#gotoWithUserId`).
 */
export async function seedReadySession(userExternalId: string): Promise<SeededSession> {
  return withUserTransaction(userExternalId, async (client, userId) => {
    const sessionId = randomUUID();
    const docText = readFixtureDoc();
    const chunks = chunkFixtureDoc(docText);
    const categoryNames = [...new Set(FIXTURE_QUESTION_POOL.map((q) => q.category))];

    await client.query(
      `INSERT INTO quiz_sessions
         (id, user_id, source_url, topic, strategy, provider, model, status,
          question_count, selected_categories)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ready',$8,$9::jsonb)`,
      [
        sessionId,
        userId,
        FIXTURE_SOURCE_URL,
        null,
        'mixed',
        'minimax',
        'MiniMax-M3', // placeholder — never invoked (Task 3)
        FIXTURE_QUESTION_POOL.length,
        JSON.stringify(categoryNames),
      ],
    );

    await client.query(
      `INSERT INTO documents
         (id, session_id, source_url, content_markdown, chunks, content_hash, byte_size, token_estimate)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
      [
        randomUUID(),
        sessionId,
        FIXTURE_SOURCE_URL,
        docText,
        JSON.stringify(chunks),
        createHash('sha256').update(docText).digest('hex'),
        Buffer.byteLength(docText, 'utf8'),
        Math.ceil(docText.length / 4),
      ],
    );

    // Skeleton rows only (sessionId/name/questionCount) — mirrors what real
    // generation (Story 2.6) leaves; submit is the sole writer of
    // correctCount/avgRawScore/weightedScore/strength.
    for (const name of categoryNames) {
      const questionCount = FIXTURE_QUESTION_POOL.filter((q) => q.category === name).length;
      await client.query(
        `INSERT INTO knowledge_categories (id, session_id, name, question_count)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (session_id, name) DO NOTHING`,
        [randomUUID(), sessionId, name, questionCount],
      );
    }

    const seededQuestions: SeededQuestion[] = [];
    const perQuestionScore: { rawScore: number; position: number }[] = [];

    for (let position = 0; position < FIXTURE_QUESTION_POOL.length; position += 1) {
      const q = FIXTURE_QUESTION_POOL[position];
      if (!q) continue;

      const questionId = randomUUID();
      await client.query(
        `INSERT INTO questions (id, session_id, position, text, type, category, explanation)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [questionId, sessionId, position, q.text, q.type, q.category, q.explanation],
      );

      for (let answerPosition = 0; answerPosition < q.answers.length; answerPosition += 1) {
        const answer = q.answers[answerPosition];
        if (!answer) continue;
        await client.query(
          `INSERT INTO answers (id, question_id, position, text, is_correct)
           VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), questionId, answerPosition, answer.text, answer.isCorrect],
        );
      }

      seededQuestions.push({
        questionId,
        category: q.category,
        type: q.type,
        position,
        text: q.text,
        selectPositions: q.selectPositions,
      });

      const correctPositions = q.answers
        .map((a, index) => (a.isCorrect ? index : -1))
        .filter((index) => index >= 0);
      const rawScore = scoreQuestion(q.type, correctPositions, [...q.selectPositions]);
      perQuestionScore.push({ rawScore, position });
    }

    // Cross-check only — exercises the same weight formula the backend
    // uses (`geometricWeights`), never asserted as a substitute for the
    // real submit response.
    void geometricWeights(FIXTURE_QUESTION_POOL.length);
    const expectedFinalScore = weightedFinalScore(perQuestionScore);

    return { sessionId, userId, questions: seededQuestions, expectedFinalScore };
  });
}

/**
 * Submits the fixture's designed answer key directly over HTTP (never by
 * re-driving the UI) — produces a genuinely `submitted` session via the
 * real `POST /api/sessions/:id/submit` endpoint, for specs (e.g. a future
 * `chat.spec.ts`) that need a post-submit session without re-walking the
 * quiz UI a second time.
 */
export async function submitViaApi(
  sessionId: string,
  userExternalId: string,
  questions: readonly SeededQuestion[] = [],
  apiBaseUrl: string = process.env['E2E_API_URL'] ?? 'http://localhost:3001',
): Promise<unknown> {
  const responses = questions.map((q) => ({
    questionId: q.questionId,
    selected: q.selectPositions,
  }));

  const response = await fetch(`${apiBaseUrl}/api/sessions/${sessionId}/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userExternalId,
    },
    body: JSON.stringify({ responses }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`submitViaApi: POST /submit failed with ${response.status}: ${body}`);
  }

  return response.json();
}
