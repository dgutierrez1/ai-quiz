// apps/web/e2e/pages/result-page.ts
//
// ResultPage (Story 5.2 Task 4, AC #1, #2) — every locator uses
// `getByTestId(...)` exclusively. Owns chat-panel locators/actions too:
// chat lives inside the result-page shell (Story 3.2/4.3), and epics.md
// names exactly four POM classes (BasePage/LandingPage/QuizPage/
// ResultPage) — there is no separate ChatPage.
//
// Results-panel `data-testid` values verified against
// `apps/web/components/result/*.tsx`. Chat-panel `data-testid` values are
// Story 4.3's pinned naming table (Dev Notes → "data-testid reference"):
// `chat-panel`, `chat-thread`, `chat-message`, `chat-message-retry`,
// `chat-view-older`, `chat-quick-action-study-next`,
// `chat-quick-action-weakest`, `chat-input`, `chat-send`,
// `chat-typing-indicator`, `chat-rate-limited`, `explain-question-{n}`.
// As of this story, `chat-panel-slot.tsx` is still Story 3.2's disabled
// placeholder (Story 4.3's real chat panel is concurrent, separately-owned
// work) — these getters are wired for whichever spec exercises them next;
// this story's own specs never assert on them.

import type { Locator, Page } from '@playwright/test';

import { BasePage } from './base-page';

export type ResultTab = 'results' | 'chat';

export class ResultPage extends BasePage {
  public constructor(page: Page) {
    super(page);
  }

  public async goto(sessionId: string, userExternalId?: string): Promise<void> {
    const path = `/result/${sessionId}`;
    if (userExternalId) {
      await this.gotoWithUserId(path, userExternalId);
      return;
    }
    await this.page.goto(path);
  }

  // ── Shell / tabs ──────────────────────────────────────────────────────

  public get heading(): Locator {
    return this.page.getByTestId('result-h1');
  }

  public get shell(): Locator {
    return this.page.getByTestId('result-page-shell');
  }

  public get tabsList(): Locator {
    return this.page.getByTestId('result-tabs-list');
  }

  public get resultsTab(): Locator {
    return this.page.getByTestId('result-tab-results');
  }

  public get chatTab(): Locator {
    return this.page.getByTestId('result-tab-chat');
  }

  public async selectTab(tab: ResultTab): Promise<void> {
    const trigger = tab === 'results' ? this.resultsTab : this.chatTab;
    await trigger.click();
  }

  // ── Results panel (Story 3.2) ────────────────────────────────────────

  public get resultsPanel(): Locator {
    return this.page.getByTestId('results-panel');
  }

  public get scoreDisplay(): Locator {
    return this.page.getByTestId('score-display');
  }

  public get categoryBreakdown(): Locator {
    return this.page.getByTestId('category-breakdown');
  }

  public strengthChip(slug: string): Locator {
    return this.page.getByTestId(`strength-chip-${slug}`);
  }

  public get questionBreakdownList(): Locator {
    return this.page.getByTestId('question-breakdown-list');
  }

  public breakdownQuestion(index: number): Locator {
    return this.page.getByTestId(`breakdown-question-${index}`);
  }

  public breakdownAnswer(questionIndex: number, position: number): Locator {
    return this.page.getByTestId(`breakdown-answer-${questionIndex}-${position}`);
  }

  public get insightsPanel(): Locator {
    return this.page.getByTestId('insights-panel');
  }

  public get insightsTopics(): Locator {
    return this.page.getByTestId('insights-topics');
  }

  public get insightsWeakCategories(): Locator {
    return this.page.getByTestId('insights-weak-categories');
  }

  // ── Chat panel (Story 3.2 slot / Story 4.3 real panel) ───────────────

  public get chatPanelSlot(): Locator {
    return this.page.getByTestId('chat-panel-slot');
  }

  public get chatPanel(): Locator {
    return this.page.getByTestId('chat-panel');
  }

  public get chatThread(): Locator {
    return this.page.getByTestId('chat-thread');
  }

  public get chatMessages(): Locator {
    return this.page.getByTestId('chat-message');
  }

  public get chatMessageRetry(): Locator {
    return this.page.getByTestId('chat-message-retry');
  }

  public get chatViewOlder(): Locator {
    return this.page.getByTestId('chat-view-older');
  }

  public get chatQuickActionStudyNext(): Locator {
    return this.page.getByTestId('chat-quick-action-study-next');
  }

  public get chatQuickActionWeakest(): Locator {
    return this.page.getByTestId('chat-quick-action-weakest');
  }

  public get chatInput(): Locator {
    return this.page.getByTestId('chat-input');
  }

  public get chatSend(): Locator {
    return this.page.getByTestId('chat-send');
  }

  public get chatTypingIndicator(): Locator {
    return this.page.getByTestId('chat-typing-indicator');
  }

  public get chatRateLimited(): Locator {
    return this.page.getByTestId('chat-rate-limited');
  }

  public explainQuestion(position: number): Locator {
    return this.page.getByTestId(`explain-question-${position}`);
  }

  public async sendChatMessage(text: string): Promise<void> {
    await this.chatInput.fill(text);
    await this.chatSend.click();
  }
}
