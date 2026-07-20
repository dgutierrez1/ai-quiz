// apps/web/e2e/tests/security.spec.ts
//
// Story 5.3 Task 1 — cross-user isolation, driven through two isolated
// Playwright browser contexts (never two tabs in one context — Story 2.7's
// UUID-before-hydration bootstrap relies on per-context `localStorage`
// isolation). Imports POM classes from `apps/web/e2e/pages/` and the
// seeding fixtures from `apps/web/e2e/fixtures/` established by Story 5.2
// — this file adds no second POM base class, no second Playwright config,
// no second seeding helper.
//
// Deterministic identities: rather than letting each context
// self-generate a UUID via the app's own bootstrap script and reading it
// back, this spec generates its own two `randomUUID()`s up front and
// seeds/navigates with them directly via `BasePage.gotoWithUserId` (the
// same pattern `full-quiz.spec.ts` already uses for a single user) — this
// is simpler and equally valid: the property under test is "does the
// server/UI ever leak user A's data to user B", not "does the bootstrap
// script generate a UUID", which Story 2.7's own tests already cover.

import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { seedReadySession, submitViaApi } from '../fixtures/seed-session';
import { QuizPage } from '../pages/quiz-page';
import { ResultPage } from '../pages/result-page';

const API_BASE_URL = process.env['E2E_API_URL'] ?? 'http://localhost:3001';

interface ErrorEnvelope {
  readonly error?: { readonly code?: string; readonly message?: string };
}

test.describe('Cross-user isolation (Story 5.3 AC #1-#3)', () => {
  test("a stranger gets 404 (never 403, never 200) on every session-scoped route, never sees another user's sessions in their list, and the UI never leaks or crashes on a foreign session id", async ({
    browser,
  }) => {
    const userAId = randomUUID();
    const userBId = randomUUID();

    // Two ISOLATED contexts — separate localStorage, separate cookie jars.
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      // Seed one `ready` (not-submitted — needed for the chat pre-submit
      // guard's own story, and here just as a plain not-yet-submitted
      // session) and one `submitted` session for user A, driven entirely
      // via direct DB seeding + the real submit API (Story 5.2's
      // established LLM-avoidance convention — no live LLM call anywhere
      // in this spec).
      const readySeed = await seedReadySession(userAId);
      const submittedSeed = await seedReadySession(userAId);
      await submitViaApi(submittedSeed.sessionId, userAId, submittedSeed.questions);

      // User B needs at least one session of their own too, for the
      // list-leakage check (AC #2) to be meaningful in both directions.
      const userBSeed = await seedReadySession(userBId);

      // ── AC #1 — direct-access isolation, every session-scoped route ──
      //
      // `context.request` is Playwright's API-testing surface — faster and
      // more precise than a full UI round-trip for asserting a raw status
      // code. Each context's own `request` fixture is used (not a shared
      // one) purely for hygiene; the header is what actually determines
      // identity server-side, not which context issues the call.
      const getAsB = await contextB.request.get(
        `${API_BASE_URL}/api/sessions/${submittedSeed.sessionId}`,
        {
          headers: { 'x-user-id': userBId },
        },
      );
      expect(getAsB.status()).toBe(404);
      expect(getAsB.status()).not.toBe(403);
      expect(getAsB.status()).not.toBe(200);
      const getAsBBody = (await getAsB.json()) as ErrorEnvelope;
      expect(getAsBBody.error?.code).toBe('NOT_FOUND');

      const submitAsB = await contextB.request.post(
        `${API_BASE_URL}/api/sessions/${readySeed.sessionId}/submit`,
        {
          headers: { 'x-user-id': userBId, 'content-type': 'application/json' },
          data: {
            responses: readySeed.questions.map((q) => ({
              questionId: q.questionId,
              selected: q.selectPositions,
            })),
          },
        },
      );
      expect(submitAsB.status()).toBe(404);
      expect(submitAsB.status()).not.toBe(403);
      expect(submitAsB.status()).not.toBe(200);

      // Chat routes only if the concurrent chat-backend story has landed
      // in this run — detected via a cheap probe (mirrors the same
      // runtime-detection convention `apps/api/test/security/
      // cross-user-isolation.security.test.ts` uses).
      const chatProbe = await contextB.request.get(
        `${API_BASE_URL}/api/sessions/00000000-0000-4000-8000-000000000000/chat`,
        { headers: { 'x-user-id': randomUUID() } },
      );
      const chatProbeBody = (await chatProbe.json().catch(() => ({}))) as ErrorEnvelope;
      const chatRoutesExist =
        chatProbe.status() === 404 && chatProbeBody.error?.message === 'Resource not found';

      if (chatRoutesExist) {
        const getChatAsB = await contextB.request.get(
          `${API_BASE_URL}/api/sessions/${readySeed.sessionId}/chat`,
          {
            headers: { 'x-user-id': userBId },
          },
        );
        expect(getChatAsB.status()).toBe(404);
        expect(getChatAsB.status()).not.toBe(403);

        const postChatAsB = await contextB.request.post(
          `${API_BASE_URL}/api/sessions/${readySeed.sessionId}/chat`,
          {
            headers: { 'x-user-id': userBId, 'content-type': 'application/json' },
            data: { content: 'hello' },
          },
        );
        expect(postChatAsB.status()).toBe(404);
        expect(postChatAsB.status()).not.toBe(403);
      } else {
        // eslint-disable-next-line no-console -- deliberate, clear skip note
        console.warn(
          '[security.spec.ts] chat routes not wired into AppModule yet in this run — skipping chat isolation checks.',
        );
      }

      // ── AC #2 — list-leakage isolation, both directions ──
      const listAsB = await contextB.request.get(`${API_BASE_URL}/api/sessions`, {
        headers: { 'x-user-id': userBId },
      });
      expect(listAsB.status()).toBe(200);
      const listAsBBody = (await listAsB.json()) as { sessions: { id: string }[] };
      const bIds = listAsBBody.sessions.map((s) => s.id);
      expect(bIds).not.toContain(readySeed.sessionId);
      expect(bIds).not.toContain(submittedSeed.sessionId);
      expect(bIds).toContain(userBSeed.sessionId);

      const listAsA = await contextA.request.get(`${API_BASE_URL}/api/sessions`, {
        headers: { 'x-user-id': userAId },
      });
      expect(listAsA.status()).toBe(200);
      const listAsABody = (await listAsA.json()) as { sessions: { id: string }[] };
      const aIds = listAsABody.sessions.map((s) => s.id);
      expect(aIds).not.toContain(userBSeed.sessionId);
      expect(aIds).toContain(readySeed.sessionId);
      expect(aIds).toContain(submittedSeed.sessionId);

      // ── AC #3 — UI-level isolation: no leak, no crash, for a bookmarked/guessed foreign id ──
      const pageErrors: Error[] = [];
      const pageB = await contextB.newPage();
      pageB.on('pageerror', (error) => pageErrors.push(error));

      const resultPage = new ResultPage(pageB);
      await resultPage.goto(submittedSeed.sessionId, userBId);
      // Give the client component a moment to attempt its fetch and settle
      // into whatever not-found/error state it renders (AC #3 does not
      // specify what that state looks like — only that it isn't a leak or
      // a crash).
      await pageB.waitForLoadState('networkidle');
      const resultBodyText = await pageB.locator('body').innerText();
      for (const question of submittedSeed.questions) {
        expect(resultBodyText).not.toContain(question.text);
      }

      const quizPage = new QuizPage(pageB);
      await quizPage.goto(readySeed.sessionId, userBId);
      await pageB.waitForLoadState('networkidle');
      const quizBodyText = await pageB.locator('body').innerText();
      for (const question of readySeed.questions) {
        expect(quizBodyText).not.toContain(question.text);
      }

      expect(
        pageErrors,
        `no unhandled client exceptions navigating to a foreign session id: ${pageErrors.map((e) => e.message).join('; ')}`,
      ).toHaveLength(0);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
