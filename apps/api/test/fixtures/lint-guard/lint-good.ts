// AC #2 — KNOWN-GOOD domain fixture.
//
// Pure-domain, no I/O, no forbidden imports. This is the shape a real domain
// file is allowed to look like: it imports nothing from `@nestjs/*`,
// `drizzle-orm`, `mastra`, `undici`, `node:fetch`, and nothing from
// `apps/api/src/adapters/` or `apps/api/src/driving/`. It MUST pass lint.
//
// Paired with `lint-bad.ts` — the two together prove the guardrail works.
// (See the comment in `lint-bad.ts` for how to verify.)

import { z } from 'zod';

export const ScoreZero = z.literal(0);
export type ScoreZero = z.infer<typeof ScoreZero>;

export function _domainPureScoreCheck(raw: number): ScoreZero | 'nonzero' {
  return raw === 0 ? ScoreZero.parse(0) : 'nonzero';
}

export const _lintGoodMarker = 'lint-good: pure domain function, no forbidden imports';
