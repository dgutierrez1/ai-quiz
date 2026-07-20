// apps/web/e2e/pages/quiz-page.ts
//
// QuizPage (Story 5.2 Task 4, AC #1, #2) — every locator uses
// `getByTestId(...)` exclusively.
//
// `data-testid` values verified against `apps/web/components/quiz/*.tsx`.
// There is no separate "submit-button" — `quiz-next-button` doubles as
// Submit on the last question (`quiz-runner.tsx`: `onClick={isLastQuestion
// ? handleSubmit : goNext}`).

import type { Locator, Page } from '@playwright/test';

import { BasePage } from './base-page';

export interface QuizAnswerStep {
  readonly selectPositions: readonly number[];
}

export class QuizPage extends BasePage {
  public constructor(page: Page) {
    super(page);
  }

  public async goto(sessionId: string, userExternalId?: string): Promise<void> {
    const path = `/quiz/${sessionId}`;
    if (userExternalId) {
      await this.gotoWithUserId(path, userExternalId);
      return;
    }
    await this.page.goto(path);
  }

  public get loadingSkeleton(): Locator {
    return this.page.getByTestId('quiz-loading-skeleton');
  }

  public get pendingRoot(): Locator {
    return this.page.getByTestId('quiz-pending-root');
  }

  public get questionCard(): Locator {
    return this.page.getByTestId('question-card');
  }

  public get questionText(): Locator {
    return this.page.getByTestId('question-text');
  }

  public get positionIndicator(): Locator {
    return this.page.getByTestId('position-indicator');
  }

  public get shortfallNote(): Locator {
    return this.page.getByTestId('shortfall-note');
  }

  public get previousButton(): Locator {
    return this.page.getByTestId('quiz-previous-button');
  }

  /** Reads "Next" on every question except the last, where it reads "Submit". */
  public get nextButton(): Locator {
    return this.page.getByTestId('quiz-next-button');
  }

  public answerOption(position: number): Locator {
    return this.page.getByTestId(`answer-option-${position}`);
  }

  public answerOptionInput(position: number): Locator {
    return this.page.getByTestId(`answer-option-input-${position}`);
  }

  public async selectPositions(positions: readonly number[]): Promise<void> {
    for (const position of positions) {
      await this.answerOption(position).click();
    }
  }

  public async goNextOrSubmit(): Promise<void> {
    await this.nextButton.click();
  }

  /**
   * Answers every question in the seeded session, in position order
   * (`seed-session.ts`'s `SeededQuestion.selectPositions`), clicking
   * Next/Submit after each one. Assumes the quiz always starts at question
   * 0 (fresh navigation) and that `steps` is ordered to match the
   * on-screen question order.
   */
  public async answerAllAndSubmit(steps: readonly QuizAnswerStep[]): Promise<void> {
    for (const step of steps) {
      await this.selectPositions(step.selectPositions);
      await this.goNextOrSubmit();
    }
  }
}
