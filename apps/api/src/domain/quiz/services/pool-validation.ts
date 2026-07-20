import type { GeneratedQuestionDto } from '@ai-quiz/shared';
const STOP = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'is',
  'it',
  'for',
  'on',
  'with',
  'this',
  'that',
  'what',
  'which',
]);
const tokens = (text: string) =>
  new Set((text.toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? []).filter((token) => !STOP.has(token)));
export function isGrounded(question: GeneratedQuestionDto, chunks: readonly string[]): boolean {
  const source = tokens(chunks.join(' '));
  const output = tokens([question.text, ...question.answers.map((a) => a.text)].join(' '));
  return [...output].some((token) => source.has(token));
}
export function hasNovelSecret(question: GeneratedQuestionDto, source: string): boolean {
  const out = [question.text, question.explanation, ...question.answers.map((a) => a.text)].join(
    ' ',
  );
  const patterns = [/sk-[A-Za-z0-9]{20,}/g, /AKIA[A-Z0-9]{16}/g, /[A-Za-z0-9+/=_-]{40,}/g];
  return patterns.some((pattern) =>
    (out.match(pattern) ?? []).some((value) => !source.includes(value)),
  );
}
