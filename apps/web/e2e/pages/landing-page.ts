// apps/web/e2e/pages/landing-page.ts
//
// LandingPage (Story 5.2 Task 4, AC #1, #2) — every locator uses
// `getByTestId(...)` exclusively; no CSS selectors, no text matchers for
// anything the app already exposes a `data-testid` for.
//
// `data-testid` values verified directly against
// `apps/web/components/landing/*.tsx` (session-form.tsx,
// provider-model-select.tsx, strategy-picker.tsx, question-count-select.tsx)
// rather than trusted from the story's own proposal table — several
// differ from that table (e.g. `source-url-input`, not `url-input`;
// `strategy-option-{value}`/`strategy-radio-{value}`, not
// `strategy-picker-{value}`).

import type { Locator, Page } from '@playwright/test';

import { BasePage } from './base-page';

export type Strategy = 'factual' | 'comprehension' | 'mixed' | 'trivia';

export class LandingPage extends BasePage {
  public constructor(page: Page) {
    super(page);
  }

  public async goto(userExternalId?: string): Promise<void> {
    if (userExternalId) {
      await this.gotoWithUserId('/', userExternalId);
      return;
    }
    await this.page.goto('/');
  }

  public get sourceUrlInput(): Locator {
    return this.page.getByTestId('source-url-input');
  }

  public get sourceUrlError(): Locator {
    return this.page.getByTestId('source-url-error');
  }

  public get topicInput(): Locator {
    return this.page.getByTestId('topic-input');
  }

  public get providerSelect(): Locator {
    return this.page.getByTestId('provider-select');
  }

  public get modelSelect(): Locator {
    return this.page.getByTestId('model-select');
  }

  public get questionCountSelect(): Locator {
    return this.page.getByTestId('question-count-select');
  }

  public get startButton(): Locator {
    return this.page.getByTestId('start-button');
  }

  public get sessionFormErrors(): Locator {
    return this.page.getByTestId('session-form-errors');
  }

  public strategyOption(strategy: Strategy): Locator {
    return this.page.getByTestId(`strategy-option-${strategy}`);
  }

  public strategyRadio(strategy: Strategy): Locator {
    return this.page.getByTestId(`strategy-radio-${strategy}`);
  }

  public async fillSourceUrl(url: string): Promise<void> {
    await this.sourceUrlInput.fill(url);
  }

  public async fillTopic(topic: string): Promise<void> {
    await this.topicInput.fill(topic);
  }

  public async selectStrategy(strategy: Strategy): Promise<void> {
    await this.strategyOption(strategy).click();
  }

  public async selectProvider(provider: string): Promise<void> {
    await this.providerSelect.selectOption(provider);
  }

  public async selectModel(model: string): Promise<void> {
    await this.modelSelect.selectOption(model);
  }

  public async selectQuestionCount(count: number): Promise<void> {
    await this.questionCountSelect.selectOption(String(count));
  }

  public async start(): Promise<void> {
    await this.startButton.click();
  }
}
