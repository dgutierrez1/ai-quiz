import type { CreatedQuestionDto } from '@ai-quiz/shared';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { QuestionResultDto, SubmittedSessionDetail } from '../../lib/types';
import { InsightsPanel } from './insights-panel';
import { ResultsPanel } from './results-panel';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

const QUESTIONS: readonly CreatedQuestionDto[] = [
  {
    id: 'q1',
    sessionId: SESSION_ID,
    position: 0,
    text: 'What is 2 + 2?',
    type: 'single',
    category: 'Math',
    explanation: '',
    answers: [
      { position: 0, text: '3', isCorrect: false },
      { position: 1, text: '4', isCorrect: true },
      { position: 2, text: '5', isCorrect: false },
      { position: 3, text: '6', isCorrect: false },
    ],
  },
  {
    id: 'q2',
    sessionId: SESSION_ID,
    position: 1,
    text: 'Pick the even numbers.',
    type: 'multiple',
    category: 'Math',
    explanation: '',
    answers: [
      { position: 0, text: '1', isCorrect: false },
      { position: 1, text: '2', isCorrect: true },
      { position: 2, text: '3', isCorrect: false },
      { position: 3, text: '4', isCorrect: true },
    ],
  },
];

const BREAKDOWN: readonly QuestionResultDto[] = [
  {
    questionId: 'q1',
    position: 0,
    rawScore: 4,
    weight: 1,
    weightedScore: 4,
    correctAnswers: [1],
    selected: [1],
  },
  {
    questionId: 'q2',
    position: 1,
    rawScore: 0,
    weight: 1,
    weightedScore: 0,
    correctAnswers: [1, 3],
    selected: [0],
  },
];

const SUBMITTED_SESSION: SubmittedSessionDetail = {
  sessionId: SESSION_ID,
  status: 'submitted',
  finalScore: 2.8,
  breakdown: BREAKDOWN,
  categoryBreakdown: [
    {
      name: 'Math',
      questionCount: 2,
      correctCount: 1,
      avgRawScore: 2,
      weightedScore: 2,
      strength: 'mixed',
    },
  ],
  insights: {
    topicsToStudy: [{ topic: 'Even numbers', reason: 'Review §2 on parity.' }],
    weakCategories: ['Math'],
  },
  questions: QUESTIONS,
};

// ScoreDisplay's count-up is real-timer/rAF-driven; force the
// reduced-motion branch so the final value renders synchronously and
// these data-mapping tests don't depend on animation timing.
beforeEach(() => {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
});

describe('ResultsPanel — data-to-view mapping', () => {
  it('renders the final score neutrally (no strength color) and count-up disabled under reduced motion', () => {
    render(<ResultsPanel session={SUBMITTED_SESSION} />);
    expect(screen.getByTestId('score-display')).toHaveTextContent('2.80');
  });

  it('renders one strength chip per category, always carrying its literal label', () => {
    render(<ResultsPanel session={SUBMITTED_SESSION} />);
    const chip = screen.getByTestId('strength-chip-math');
    expect(chip).toHaveTextContent('Math');
    expect(chip).toHaveTextContent('mixed');
    expect(chip).toHaveAttribute('data-strength', 'mixed');
  });

  it('never renders a category with 0 questions', () => {
    render(
      <ResultsPanel
        session={{
          ...SUBMITTED_SESSION,
          categoryBreakdown: [
            ...SUBMITTED_SESSION.categoryBreakdown,
            {
              name: 'Empty',
              questionCount: 0,
              correctCount: 0,
              avgRawScore: 0,
              weightedScore: 0,
              strength: 'weak',
            },
          ],
        }}
      />,
    );
    expect(screen.queryByTestId('strength-chip-empty')).not.toBeInTheDocument();
  });

  it('zips breakdown[] to question/answer data, in server order, marking correct and selected answers', () => {
    render(<ResultsPanel session={SUBMITTED_SESSION} />);
    const list = screen.getByTestId('question-breakdown-list');
    expect(list).toBeInTheDocument();

    const q1 = screen.getByTestId('breakdown-question-0');
    expect(q1).toHaveTextContent('What is 2 + 2?');
    const q1CorrectSelected = screen.getByTestId('breakdown-answer-0-1');
    expect(q1CorrectSelected).toHaveAttribute('data-correct', 'true');
    expect(q1CorrectSelected).toHaveAttribute('data-selected', 'true');
    expect(q1CorrectSelected).toHaveTextContent('Correct answer');
    expect(q1CorrectSelected).toHaveTextContent('Your selection');

    const q2 = screen.getByTestId('breakdown-question-1');
    expect(q2).toHaveTextContent('Pick the even numbers.');
    const q2WrongSelected = screen.getByTestId('breakdown-answer-1-0');
    expect(q2WrongSelected).toHaveAttribute('data-correct', 'false');
    expect(q2WrongSelected).toHaveAttribute('data-selected', 'true');
    expect(q2WrongSelected).toHaveTextContent('not correct');
  });

  it('renders insights inline with no "Analyze gaps" trigger anywhere', () => {
    render(<ResultsPanel session={SUBMITTED_SESSION} />);
    expect(screen.getByTestId('insights-panel')).toBeInTheDocument();
    expect(screen.getByTestId('insights-topics')).toHaveTextContent('Even numbers');
    expect(screen.queryByText(/analyze gaps/i)).not.toBeInTheDocument();
  });
});

describe('InsightsPanel — defensive rendering', () => {
  it('renders without throwing on a minimal/partial topicsToStudy fixture', () => {
    const malformed = [
      {},
      { topic: 123 },
      { topic: 'Real topic', reason: undefined },
    ] as unknown as {
      topic: string;
    }[];
    expect(() =>
      render(<InsightsPanel insights={{ topicsToStudy: malformed, weakCategories: undefined }} />),
    ).not.toThrow();
    expect(screen.getByText('Real topic')).toBeInTheDocument();
  });

  it('renders nothing when insights are entirely absent', () => {
    const { container } = render(<InsightsPanel insights={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
