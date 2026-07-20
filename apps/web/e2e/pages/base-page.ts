// apps/web/e2e/pages/base-page.ts
//
// BasePage (Story 5.2 Task 4, AC #1) — every other POM class extends this.

import type { Page } from '@playwright/test';

/** The `localStorage` key `app/layout.tsx`'s pre-hydration bootstrap script reads/writes (Story 2.7 AC #2). */
export const USER_ID_STORAGE_KEY = 'ai-quiz.user.id';

export class BasePage {
  public constructor(protected readonly page: Page) {}

  /**
   * Seeds `localStorage`'s UUID key via `page.addInitScript` — which runs
   * before ANY page script on every subsequent navigation in this page —
   * so the app's own pre-hydration bootstrap script
   * (`app/layout.tsx#uuidBootstrap`) sees an existing UUID and never
   * generates a new one (it only writes when no valid UUID is already
   * present). This lets tests drive the browser under a KNOWN
   * `X-User-Id` matching whatever `seed-session.ts` wrote server-side —
   * without this, the browser's self-generated UUID would never match a
   * seeded session's owner and every request would 404 (not-found and
   * not-owned are indistinguishable by design).
   */
  public async gotoWithUserId(path: string, userExternalId: string): Promise<void> {
    await this.page.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [USER_ID_STORAGE_KEY, userExternalId] as const,
    );
    await this.page.goto(path);
  }
}
