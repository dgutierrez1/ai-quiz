// packages/shared/src/index.ts
//
// Public entry point for `@ai-quiz/shared`. Story 1.2 surface only:
//   • schemas  — Zod source-of-truth for scoring DTOs (positions, questions,
//                user_responses, knowledge_categories).
//   • scoring  — pure functions (geometricWeights, scoreQuestion,
//                weightedFinalScore, aggregateByCategory, rankWeakCategories,
//                strengthFor) + shared rounding helper + ScoringError.
//   • dto      — re-exports of the z.infer-derived type aliases.
//
// Session, document, chat, LLM-output schemas belong to Stories 1.3 / 1.4 /
// Epic 2 and are NOT exported here.

export * from './dto.js';
export * from './schemas.js';
export * from './scoring.js';
