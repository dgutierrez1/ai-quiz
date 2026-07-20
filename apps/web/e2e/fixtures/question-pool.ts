// apps/web/e2e/fixtures/question-pool.ts
//
// Fixed, deterministic question pool (Story 5.2 Task 2) used by
// `seed-session.ts` to write a `ready`-status session directly into
// Postgres — no live LLM call anywhere in this suite's CI-gating specs
// (Dev Notes → LLM-avoidance strategy #1).
//
// 6 questions across exactly 3 categories (2 questions each), text that
// genuinely token-overlaps `fixture-doc.md` so the fixture stays honest
// even though nothing in this story invokes the real grounding check.
// `selectPositions` is what `quiz-page.ts`'s `answerAllAndSubmit` clicks —
// deliberately NOT always the correct positions, because the whole point
// of this fixture is to drive `strengthFor`'s real thresholds (Story 1.2)
// to a designed, deterministic split:
//
//   FERMENTATION — both questions answered fully correct  → avgRawScore 4.0 → strong
//   INGREDIENTS  — one fully correct, one fully wrong      → avgRawScore 2.0 → mixed
//   BAKING       — both questions answered fully wrong     → avgRawScore 0.0 → weak
//
// Every score sits comfortably inside its bucket (4.0 / 2.0 / 0.0 against
// thresholds >=3.0 / [1.6,3.0) / <1.6) — no boundary-adjacent floats.

export type FixtureQuestionType = 'single' | 'multiple';

export interface FixtureAnswer {
  readonly text: string;
  readonly isCorrect: boolean;
}

export interface FixtureQuestion {
  readonly category: string;
  readonly type: FixtureQuestionType;
  readonly text: string;
  readonly explanation: string;
  /** Exactly 4, position = array index (mirrors `answers.position`). */
  readonly answers: readonly FixtureAnswer[];
  /**
   * Positions (0-3) the E2E test clicks when answering this question.
   * Deliberately NOT always `answers[i].isCorrect` — see module doc.
   */
  readonly selectPositions: readonly number[];
}

export const FIXTURE_CATEGORIES = {
  STRONG: 'Fermentation',
  MIXED: 'Ingredients',
  WEAK: 'Baking',
} as const;

export const FIXTURE_QUESTION_POOL: readonly FixtureQuestion[] = [
  // ── Fermentation (strong: both answered fully correct) ──────────────────
  {
    category: FIXTURE_CATEGORIES.STRONG,
    type: 'single',
    text: 'What primarily drives sourdough fermentation, per the guide?',
    explanation:
      'The guide states fermentation is driven by wild yeast and lactic acid bacteria living in the starter.',
    answers: [
      { text: 'Wild yeast and lactic acid bacteria in the starter', isCorrect: true },
      { text: 'Added commercial baking powder', isCorrect: false },
      { text: 'Refined white sugar', isCorrect: false },
      { text: 'Added vinegar', isCorrect: false },
    ],
    selectPositions: [0],
  },
  {
    category: FIXTURE_CATEGORIES.STRONG,
    type: 'multiple',
    text: 'Which of the following affect sourdough fermentation speed, per the guide?',
    explanation:
      'A warmer kitchen speeds fermentation; refrigerating the dough overnight slows it for a more complex flavor.',
    answers: [
      { text: 'A warmer kitchen', isCorrect: true },
      { text: 'Refrigerating the dough overnight', isCorrect: true },
      { text: 'The color of the mixing bowl', isCorrect: false },
      { text: 'The brand printed on the flour bag', isCorrect: false },
    ],
    selectPositions: [0, 1],
  },

  // ── Ingredients (mixed: one fully correct, one fully wrong) ─────────────
  {
    category: FIXTURE_CATEGORIES.MIXED,
    type: 'single',
    text: 'Which four ingredients does sourdough bread need, per the guide?',
    explanation: 'The guide lists flour, water, salt, and a live sourdough starter.',
    answers: [
      { text: 'Flour, water, salt, and a live starter', isCorrect: true },
      { text: 'Flour, water, yeast packets, and sugar', isCorrect: false },
      { text: 'Flour, milk, butter, and eggs', isCorrect: false },
      { text: 'Flour, water, baking soda, and salt', isCorrect: false },
    ],
    selectPositions: [0],
  },
  {
    category: FIXTURE_CATEGORIES.MIXED,
    type: 'multiple',
    text: 'Which of the following are true about sourdough ingredients, per the guide?',
    explanation:
      "Bread flour's high protein strengthens the gluten network, and fine sea salt dissolves evenly through the dough.",
    answers: [
      { text: "Bread flour's high protein strengthens the gluten network", isCorrect: true },
      { text: 'Chlorinated tap water speeds up fermentation', isCorrect: false },
      { text: 'Fine sea salt dissolves evenly through the dough', isCorrect: true },
      { text: 'Salt is optional in a basic sourdough dough', isCorrect: false },
    ],
    // Deliberately selects ONLY the wrong positions (1 and 3) — hits=0,
    // misses=2 → rawScore clamps to 0.
    selectPositions: [1, 3],
  },

  // ── Baking (weak: both answered fully wrong) ─────────────────────────────
  {
    category: FIXTURE_CATEGORIES.WEAK,
    type: 'single',
    text: 'What does baking sourdough in a preheated Dutch oven trap, per the guide?',
    explanation:
      'Trapped steam keeps the crust soft long enough for the loaf to fully expand before it sets.',
    answers: [
      { text: 'Steam, keeping the crust soft during oven spring', isCorrect: true },
      { text: 'Smoke, for flavor', isCorrect: false },
      { text: 'Cold air, to slow the bake', isCorrect: false },
      { text: 'Extra flour dust', isCorrect: false },
    ],
    // Deliberately wrong.
    selectPositions: [1],
  },
  {
    category: FIXTURE_CATEGORIES.WEAK,
    type: 'multiple',
    text: 'Which statements about baking a sourdough loaf are true, per the guide?',
    explanation:
      "The Dutch oven's lid typically comes off partway through baking, and trapped steam helps the crust stay soft long enough for full expansion.",
    answers: [
      { text: "The Dutch oven's lid typically comes off partway through baking", isCorrect: true },
      { text: 'The lid stays on for the entire bake', isCorrect: false },
      {
        text: 'Trapped steam helps the crust stay soft long enough for full expansion',
        isCorrect: true,
      },
      { text: 'A cold oven produces the best oven spring', isCorrect: false },
    ],
    // Deliberately selects ONLY the wrong positions (1 and 3) — hits=0,
    // misses=2 → rawScore clamps to 0.
    selectPositions: [1, 3],
  },
];
