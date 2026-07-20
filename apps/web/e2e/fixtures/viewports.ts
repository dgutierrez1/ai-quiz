// apps/web/e2e/fixtures/viewports.ts
//
// Single source of truth for every Playwright viewport this suite uses
// (Story 5.2 Task 8). `playwright.config.ts` imports these constants for
// its `desktop`/`mobile` projects — no second hardcoded width is allowed
// to exist anywhere else in this story's files (AC #8).
//
// Breakpoint correction (Story 5.2 Dev Notes, resolved 2026-07-20):
// `ARCHITECTURE-SPINE.md#AD-21` was amended the same day — the ONE
// structural breakpoint in this app is Tailwind's built-in `lg` token
// (`--breakpoint-lg`, `64rem` = **1024px**), not the stale `md`/768px value
// still present in epics.md's own un-patched Story 5.2 AC text. Below
// `lg`, `ResultPageShell`'s `lg:grid` dual-panel collapses to the
// `Tabs` (Results/Chat) layout (Story 3.2 AC #2).
//
// `1024`/`768` are used here as literal integers, per AD-21's own
// instruction: "non-CSS consumers use the literals 1024 / 768" — Playwright
// takes an integer-pixel `viewport` option and has no way to read a CSS
// custom property or a Tailwind rem token at config-evaluation time.
export const STRUCTURAL_BREAKPOINT_PX = 1024; // Tailwind `lg` / `--breakpoint-lg` (64rem) — AD-21, the ONLY structural boundary
export const NON_STRUCTURAL_BREAKPOINT_PX = 768; // Tailwind `md` — kept for reference only; nothing in this app collapses here

/**
 * The `mobile` Playwright project's viewport. Deliberately well below
 * `STRUCTURAL_BREAKPOINT_PX` (not just under it) so the dual-panel/tabs
 * collapse is unambiguous — this is a real phone width (iPhone 12/13/14
 * class), not a boundary-probing value.
 */
export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

/**
 * The `desktop` Playwright project's viewport — comfortably above
 * `STRUCTURAL_BREAKPOINT_PX` so the dual-panel grid renders.
 */
export const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
