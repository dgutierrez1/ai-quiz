// Root ESLint flat config — see story 1.1 and architecture spine AD-2.
//
// Conventions:
// - ESLint 10.7.0 (eslintrc removed; this is the only config file).
// - typescript-eslint meta-package with parserOptions.projectService: true (typed linting).
// - simple-import-sort for deterministic import order across the monorepo.
// - Built-in `no-console` enforced everywhere EXCEPT apps/api/src/adapters/**
//   (this is the "@ai-quiz/no-console-log" enforcement — a built-in rule with a
//    path override; no custom rule needed).
// - `no-restricted-imports` is scoped to apps/api/src/domain/** and forbids
//   both external (5 modules + nest/mastra namespace patterns) AND internal
//   (adapters, driving) paths. `allowTypeImports: true` is per-path because
//   the layer table allows type-only imports from the domain.
//
//   Spec note: the project-context suggests `@typescript-eslint/no-restricted-imports`,
//   but that rule wraps its options schema in a single-element tuple that
//   doesn't compose cleanly with flat config's `[severity, option1, ...]`
//   rule-value model. The base `no-restricted-imports` rule natively supports
//   per-path `allowTypeImports` (ESLint 9.10+), so we use it instead. Both
//   rules share the same AST checks; only the option schema shape differs.
// - `@ai-quiz/local` plugin is wired in with empty `rules: {}`; custom rules
//   (no-unscoped-session-query / require-data-testid / etc.) land with the
//   code they guard in later stories — Story 1.1 builds the harness only.

import localPlugin from '@ai-quiz/eslint-plugin-local';
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';

const domainRestrictedImportsObject = {
  paths: [
    {
      name: '@nestjs/core',
      message: 'domain MUST NOT import from @nestjs/* (spine AD-2)',
      allowTypeImports: true,
    },
    {
      name: '@nestjs/common',
      message: 'domain MUST NOT import from @nestjs/* (spine AD-2)',
      allowTypeImports: true,
    },
    {
      name: '@nestjs/platform-express',
      message: 'domain MUST NOT import from @nestjs/* (spine AD-2)',
      allowTypeImports: true,
    },
    {
      name: '@nestjs/config',
      message: 'domain MUST NOT import from @nestjs/* (spine AD-2)',
      allowTypeImports: true,
    },
    {
      name: '@nestjs/throttler',
      message: 'domain MUST NOT import from @nestjs/* (spine AD-2)',
      allowTypeImports: true,
    },
    {
      name: '@nestjs/platform-fastify',
      message: 'domain MUST NOT import from @nestjs/* (spine AD-2)',
      allowTypeImports: true,
    },
    {
      name: 'drizzle-orm',
      message: 'domain MUST NOT import drizzle-orm (spine AD-2)',
      allowTypeImports: true,
    },
    {
      name: 'mastra',
      message: 'domain MUST NOT import mastra (spine AD-2)',
      allowTypeImports: true,
    },
    {
      name: '@mastra/core',
      message: 'domain MUST NOT import mastra (spine AD-2)',
      allowTypeImports: true,
    },
    {
      name: '@mastra/nestjs',
      message: 'domain MUST NOT import mastra (spine AD-2)',
      allowTypeImports: true,
    },
    {
      name: 'undici',
      message: 'domain MUST NOT import undici (spine AD-2)',
      allowTypeImports: true,
    },
    {
      name: 'node:fetch',
      message: 'domain MUST NOT import node:fetch (spine AD-2)',
      allowTypeImports: true,
    },
  ],
  patterns: [
    {
      group: [
        '@nestjs/*',
        '@mastra/*',
        // ESLint's `no-restricted-imports` matches against the literal
        // specifier via `ignore`, which does NOT cross `..` segments. So
        // each realistic depth from `apps/api/src/domain/**` needs its own
        // pattern. Depth 4 is the deepest (use-cases/<feature>/foo.ts);
        // Story 1.4 lands there. node_modules is excluded by the rule's
        // own scope (`files: ['apps/api/src/domain/**/*.ts']`) so no
        // third-party `<pkg>/adapters/...` paths collide.
        '../adapters/**',
        '../../adapters/**',
        '../../../adapters/**',
        '../../../../adapters/**',
        '../driving/**',
        '../../driving/**',
        '../../../driving/**',
        '../../../../driving/**',
      ],
      message: 'domain MUST NOT import adapters or driving layer or external I/O (spine AD-2)',
      allowTypeImports: true,
    },
  ],
};

export default defineConfig(
  // ── Global ignores ─────────────────────────────────────────────────────────
  // Tooling / planning artifacts must never be linted.
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/out/**',
    '**/coverage/**',
    '**/playwright-report/**',
    '**/test-results/**',
    '**/*.tsbuildinfo',
    '**/*.json',
    '**/*.md',
    '**/*.yml',
    '**/*.yaml',
    '_bmad-output/**',
    '_bmad/**',
    '.opencode/**',
    '.agents/**',
    '.claude/**',

    // AC #2 lint fixtures — intentionally ignored by default. To prove the
    // guardrail, remove this single entry (or comment it out) and re-run
    // `pnpm lint:check` — the bad fixture must fail with a no-restricted-imports
    // violation, and the good one must still pass.
    'apps/api/src/domain/__fixtures__/**',
  ]),

  // ── Baseline JS recommended ────────────────────────────────────────────────
  js.configs.recommended,

  // ── typescript-eslint recommended (non type-checked; projectService enabled below) ──
  // We do NOT use *TypeChecked presets yet — no domain code exists, and the only
  // TS-aware rule we need (no-restricted-imports) is a syntactic check on import
  // specifiers. Switching to type-checked later is a one-line change.
  tseslint.configs.recommended,

  // ── Base rules for all JS/TS source ────────────────────────────────────────
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,jsx}'],
    plugins: {
      'simple-import-sort': simpleImportSort,
      '@ai-quiz/local': localPlugin,
    },
    languageOptions: {
      ecmaVersion: 2025,
      sourceType: 'module',
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      // Built-in no-console is the @ai-quiz/no-console-log enforcement.
      // Path override in the adapter block below disables it there (only place
      // structured logging is allowed at this layer).
      'no-console': 'error',

      // The harness is empty — no local rules yet. Each rule lands with the
      // code it guards (Story 1.4: no-unscoped-session-query, etc.).
      '@ai-quiz/local/no-unscoped-session-query': 'off',
      '@ai-quiz/local/require-data-testid': 'off',
      '@ai-quiz/local/no-console-log': 'off',

      // typescript-eslint recommended is mildly noisy for greenfield code;
      // disable the few that would force us to invent code that doesn't exist yet.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },

  // ── TS-specific parser options ─────────────────────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── AC #2 fixtures: separate config block so the parser doesn't need them
  //    in any tsconfig (they import `@nestjs/core` to prove the rule fires).
  //    In normal operation the `globalIgnores` at the top of this file
  //    excludes them; this block is only consulted when --no-ignore is used
  //    (e.g. to verify the guardrail manually).
  {
    files: ['apps/api/src/domain/__fixtures__/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
  },

  // ── Domain purity (AD-2) ───────────────────────────────────────────────────
  // Forbids imports from the 5 external modules + the internal adapters/driving
  // layers — scoped to apps/api/src/domain/**. This is the AC #2 enforcement.
  {
    files: ['apps/api/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', domainRestrictedImportsObject],
    },
  },

  // ── Adapters: structured logging is fine ───────────────────────────────────
  // The built-in no-console is the @ai-quiz/no-console-log enforcement; only
  // the adapter layer may use console (for raw I/O trace lines before pino
  // captures them).
  {
    files: ['apps/api/src/adapters/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // ── Config files: relax strictness ─────────────────────────────────────────
  // ESLint config + vitest configs — these are scaffolding, not application code.
  // `projectService: false` so typescript-eslint doesn't try to type-check them
  // (per-workspace vitest.config.ts is outside each workspace's tsconfig.json include).
  {
    files: ['eslint.config.js', 'vitest.config.ts', '**/vitest.config.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
