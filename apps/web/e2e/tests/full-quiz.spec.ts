// apps/web/e2e/tests/full-quiz.spec.ts
//
// Story 5.2 AC #5, #6, #11 — the canonical happy path. A deterministically
// seeded `ready` session (`seed-session.ts`, RLS-respecting — AC #13) is
// answered end-to-end, submitted through the real UI, and the result page
// is asserted for score + category breakdown + insights. Zero live LLM
// calls anywhere in this spec (Dev Notes → LLM-avoidance strategy #1/#2):
// generation is DB-seeded, and submit is pure math + a deterministic
// token-overlap matcher (AD-15, Story 3.1 AC #14).
//
// Runs under BOTH the `desktop` and `mobile` Playwright projects
// (`playwright.config.ts`) — the single-mount guardrail (AC #6) is the
// concrete regression test for Story 3.2's documented DOM trap: two
// separate JSX subtrees (one per breakpoint) would fail
// `toHaveCount(1)` immediately, at either viewport.

import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { seedReadySession } from '../fixtures/seed-session';
import { QuizPage } from '../pages/quiz-page';
import { ResultPage } from '../pages/result-page';

test.describe('Full quiz happy path', () => {
  test('answers every question, submits, and lands on /result/[id] with score + category breakdown + insights', async ({
    page,
  }, testInfo) => {
    const userExternalId = randomUUID();
    const seeded = await seedReadySession(userExternalId);

    const quiz = new QuizPage(page);
    const result = new ResultPage(page);

    await quiz.goto(seeded.sessionId, userExternalId);
    await expect(quiz.questionCard).toBeVisible();

    const [submitResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/sessions/${seeded.sessionId}/submit`) &&
          res.request().method() === 'POST',
      ),
      quiz.answerAllAndSubmit(seeded.questions),
    ]);
    expect(submitResponse.ok()).toBe(true);
    const submitBody = (await submitResponse.json()) as {
      readonly finalScore: number;
      readonly categoryBreakdown: readonly { readonly name: string; readonly strength: string }[];
      readonly insights?: { readonly topicsToStudy?: readonly { readonly topic: string }[] };
    };

    // AC #11 — gap-analysis/insights side-channel: attach the REAL submit
    // response payload as a testInfo annotation, satisfying NFR-4/AD-N10
    // as a side effect of the normal pass (no separate test run).
    testInfo.annotations.push({
      type: 'gap-analysis',
      description: JSON.stringify({
        categoryBreakdown: submitBody.categoryBreakdown,
        insights: submitBody.insights,
      }),
    });

    await page.waitForURL(new RegExp(`/result/${seeded.sessionId}`));
    await expect(result.heading).toBeVisible();

    // AC #6 — single-mount guardrail. Playwright's `getByTestId` locator is
    // strict-mode by default: `toHaveCount(1)` (and any other assertion
    // that resolves the locator) throws immediately if two elements ever
    // match — the regression this asserts against is exactly two separate
    // JSX subtrees for "mobile tabs" vs "desktop grid".
    await expect(result.resultsPanel).toHaveCount(1);
    await expect(result.chatPanelSlot).toHaveCount(1);

    // Score renders (Story 3.2 AC #6).
    await expect(result.scoreDisplay).toBeVisible();
    await expect(result.scoreDisplay).toContainText(submitBody.finalScore.toFixed(2));

    // Category breakdown — the fixture is designed (question-pool.ts) to
    // produce exactly one strong, one mixed, and one weak category.
    await expect(result.categoryBreakdown).toBeVisible();
    await expect(result.strengthChip('fermentation')).toHaveAttribute('data-strength', 'strong');
    await expect(result.strengthChip('ingredients')).toHaveAttribute('data-strength', 'mixed');
    await expect(result.strengthChip('baking')).toHaveAttribute('data-strength', 'weak');

    // Insights render inline for the weak category (UJ-1) — no separate
    // "Analyze gaps" trigger, no insight endpoint call.
    await expect(result.insightsPanel).toBeVisible();
    await expect(result.insightsTopics).toContainText('Baking');

    // User's selections are echoed in `breakdown[*].selected` and surfaced
    // as `data-selected="true"` on the matching answer row, so a user can
    // see what they actually picked vs. the correct answer (AC #8 —
    // "Your selection" tag).
    const submitWithSelected = submitBody as {
      readonly breakdown: readonly {
        readonly questionId: string;
        readonly selected: readonly number[];
      }[];
    };
    expect(submitWithSelected.breakdown.length).toBe(seeded.questions.length);
    for (const [questionIndex, breakdownRow] of submitWithSelected.breakdown.entries()) {
      expect(breakdownRow.selected).toEqual(seeded.questions[questionIndex]!.selectPositions);
      for (const position of breakdownRow.selected) {
        await expect(result.breakdownAnswer(questionIndex, position)).toHaveAttribute(
          'data-selected',
          'true',
        );
      }
    }
  });
});
