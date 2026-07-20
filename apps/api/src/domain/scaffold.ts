// Placeholder so `apps/api/src/domain/tsconfig.json` has at least one input.
// The tsconfig extends `tsconfig.base.json` and includes `**/*.ts`; without a
// non-fixture, non-`.gitkeep` `.ts` file at the root, `tsc -p ... --noEmit`
// emits `TS18003: No inputs were found`. Story 1.4 will replace this with real
// domain code (use-cases, ports, etc.).

export const _domainScaffold = 'Story 1.1: domain tsconfig placeholder';
