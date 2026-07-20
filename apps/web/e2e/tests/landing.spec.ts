// apps/web/e2e/tests/landing.spec.ts
//
// Story 5.2 AC #4 — URL entry, provider/model dropdown population and
// selection, strategy selection (no pre-selected value), the
// `questionCount` control, and Start.
//
// `POST /api/sessions` is network-intercepted (Dev Notes → LLM-avoidance
// strategy #3) so this spec never waits on a real backend generation call.
// `GET /api/config/providers` is left un-mocked — cheap, LLM-free — so
// this spec also guards a regression in that endpoint (Story 2.3).

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { LandingPage } from '../pages/landing-page';

const CANNED_SESSION_ID = '11111111-1111-4111-8111-111111111111';

async function mockCreateSession(page: Page): Promise<void> {
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: CANNED_SESSION_ID,
        status: 'ready',
        questionCount: 8,
        questions: [],
      }),
    });
  });
}

test.describe('Landing page — start flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockCreateSession(page);
  });

  test('provider select is populated from the live GET /api/config/providers endpoint', async ({
    page,
  }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    await expect(landing.providerSelect).toBeVisible();
    const providerOptions = await landing.providerSelect.locator('option').allTextContents();
    expect(providerOptions.length).toBeGreaterThan(0);

    await expect(landing.modelSelect).toBeVisible();
    const modelOptions = await landing.modelSelect.locator('option').allTextContents();
    expect(modelOptions.length).toBeGreaterThan(0);
  });

  test('changing the provider changes the selected model', async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    const initialModel = await landing.modelSelect.inputValue();
    await landing.selectProvider('openrouter');
    await expect(landing.modelSelect).not.toHaveValue(initialModel);
  });

  test('the strategy picker has no pre-selected value', async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    await expect(landing.strategyRadio('factual')).not.toBeChecked();
    await expect(landing.strategyRadio('comprehension')).not.toBeChecked();
    await expect(landing.strategyRadio('mixed')).not.toBeChecked();
    await expect(landing.strategyRadio('trivia')).not.toBeChecked();
  });

  test('selecting a strategy checks its radio and unchecks the others', async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    await landing.selectStrategy('comprehension');
    await expect(landing.strategyRadio('comprehension')).toBeChecked();
    await expect(landing.strategyRadio('factual')).not.toBeChecked();
    await expect(landing.strategyRadio('mixed')).not.toBeChecked();
    await expect(landing.strategyRadio('trivia')).not.toBeChecked();
  });

  test('the questionCount control defaults to 8', async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    await expect(landing.questionCountSelect).toHaveValue('8');
  });

  test('Start stays disabled until the form is valid', async ({ page }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    await expect(landing.startButton).toBeDisabled();

    await landing.fillSourceUrl('https://example.com/article.md');
    await expect(landing.startButton).toBeDisabled(); // strategy still unset

    await landing.selectStrategy('mixed');
    await expect(landing.startButton).toBeEnabled();
  });

  test('a valid submission fires POST /api/sessions and routes toward /quiz/[id] on a ready response', async ({
    page,
  }) => {
    const landing = new LandingPage(page);
    await landing.goto();

    await landing.fillSourceUrl('https://example.com/article.md');
    await landing.selectStrategy('mixed');

    const [request] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/api/sessions') && req.method() === 'POST'),
      landing.start(),
    ]);
    expect(request.method()).toBe('POST');

    await page.waitForURL(new RegExp(`/quiz/${CANNED_SESSION_ID}`));
  });
});
