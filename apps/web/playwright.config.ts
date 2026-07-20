// apps/web/playwright.config.ts
//
// Story 5.2 Task 1 — two projects (`desktop`/`mobile`), a `webServer` pair
// that boots `apps/api` and `apps/web`, and `reuseExistingServer:
// !process.env.CI` for local iteration speed.

import { defineConfig } from '@playwright/test';

import {
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
  STRUCTURAL_BREAKPOINT_PX,
} from './e2e/fixtures/viewports';

// Config-evaluation-time invariant: the `mobile` project's viewport MUST
// sit below the structural breakpoint (AD-21, `lg` = 1024px), or the whole
// point of the second project — proving the dual-panel collapses to Tabs
// (Story 3.2 AC #2) — silently stops being true.
if (MOBILE_VIEWPORT.width >= STRUCTURAL_BREAKPOINT_PX) {
  throw new Error(
    `playwright.config.ts: MOBILE_VIEWPORT.width (${MOBILE_VIEWPORT.width}) must be below ` +
      `STRUCTURAL_BREAKPOINT_PX (${STRUCTURAL_BREAKPOINT_PX}) or the mobile project never exercises the Tabs collapse.`,
  );
}

const IS_CI = Boolean(process.env['CI']);

// Local docker-compose Postgres default (docker-compose.yml / .env.example)
// — the same fallback `seed-session.ts` uses. Both files fall back to this
// literal independently because they run in different processes (this
// config spawns the API server; `seed-session.ts` runs inside the Node
// test worker), not because one is a copy of the other.
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://ai_quiz:ai_quiz@localhost:5432/ai_quiz';

// Port 3001 matches `apps/web/lib/api.ts`'s own hardcoded fallback
// (`NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'`) — pointing the real
// API server at that exact port means the web app reaches it correctly
// even in the case where a Next.js dev server does not inline a
// bracket-notation `process.env['NEXT_PUBLIC_API_URL']` read the same way
// it inlines dot-notation reads. `NEXT_PUBLIC_API_URL` is still passed
// through below for correctness if it IS inlined.
const API_PORT = 3001;
const WEB_PORT = 3000;
const API_BASE_URL = `http://localhost:${API_PORT}`;
const WEB_BASE_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 2 : 0,
  workers: IS_CI ? 2 : undefined,
  reporter: IS_CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    baseURL: WEB_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Opt-in escape hatch, inert by default (`executablePath: undefined` is
    // Playwright's normal auto-resolved-revision behavior). Only takes
    // effect when a developer/CI environment explicitly sets
    // `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` — e.g. to point at an
    // already-installed browser binary at a different cached revision than
    // this pinned `@playwright/test` version's default, without triggering
    // a download. Never required for normal `playwright install` usage.
    launchOptions: {
      executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] || undefined,
    },
  },

  // Desktop: comfortably above the structural breakpoint (dual-panel grid).
  // Mobile: below it (Tabs collapse) — see the invariant check above.
  // 1024 / 768 are AD-21's own literal-integer values for non-CSS
  // consumers; Playwright's `viewport` option takes integer pixels and has
  // no way to read a CSS custom property or Tailwind rem token at
  // config-evaluation time (see `e2e/fixtures/viewports.ts` for the full
  // rationale — the single source of truth for both numbers).
  projects: [
    {
      name: 'desktop',
      use: { browserName: 'chromium', viewport: DESKTOP_VIEWPORT },
    },
    {
      name: 'mobile',
      use: { browserName: 'chromium', viewport: MOBILE_VIEWPORT },
    },
  ],

  webServer: [
    {
      // Build then start `apps/api` against the docker-compose Postgres
      // (migrations already applied — see Story 1.3/1.4). `../api/...` is
      // relative to this config's own directory (`apps/web`, Playwright's
      // default webServer cwd) — `apps/api` is a sibling directory.
      // The `...` suffix builds `@ai-quiz/api`'s workspace dependencies too,
      // which is what produces `packages/test-doubles/dist` — required because
      // the api resolves the fakes below through a dynamic import at boot.
      command: 'pnpm --filter @ai-quiz/api... run build && node ../api/dist/main.js',
      url: `${API_BASE_URL}/healthz`,
      reuseExistingServer: !IS_CI,
      timeout: 120_000,
      env: {
        DATABASE_URL,
        API_PORT: String(API_PORT),
        NODE_ENV: 'test',
        WEB_ORIGIN: WEB_BASE_URL,
        // Deterministic, network-free, provider-credit-free. Note that no
        // current spec reaches either port (landing.spec.ts intercepts the
        // session POST in the browser; the others seed Postgres directly), so
        // today this is belt-and-braces — but it is the seam any future spec
        // that does exercise generation or chat will need, and without it such
        // a spec would silently attempt a real provider call.
        AI_QUIZ_FAKE_ADAPTERS: 'llm,ingestion',
      },
    },
    {
      command: 'pnpm --filter @ai-quiz/web run dev',
      url: WEB_BASE_URL,
      reuseExistingServer: !IS_CI,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_URL: API_BASE_URL,
      },
    },
  ],
});
