import { DocTooLargeError } from '../errors/doc-too-large.error.js';
import { DocTooShortError } from '../errors/doc-too-short.error.js';

export const MAX_DECODED_MARKDOWN_BYTES = 2 * 1024 * 1024;
export const MAX_TOKEN_ESTIMATE = 125_000;
export const MIN_TOKENS_PER_QUESTION = 500;

export function assertDocByteSize(rawMarkdown: string): void {
  if (Buffer.byteLength(rawMarkdown, 'utf8') > MAX_DECODED_MARKDOWN_BYTES)
    throw new DocTooLargeError('decoded markdown exceeds 2 MiB');
}
export function assertTokenEstimateCeiling(tokens: number): void {
  if (tokens > MAX_TOKEN_ESTIMATE)
    throw new DocTooLargeError('document exceeds the 125k token estimate cap');
}
export function assertModelContextWindow(tokens: number, contextWindowTokens: number): void {
  if (tokens > contextWindowTokens)
    throw new DocTooLargeError('switch provider/model — e.g. MiniMax-M3 supports 1M tokens');
}
export function assertContentDensity(tokens: number, questionCount: number): void {
  if (tokens / questionCount < MIN_TOKENS_PER_QUESTION) {
    // Say what the document CAN support, not just that it is too small.
    // Rounding to whole-thousands made every short document report the same
    // "~1k tokens", which reads like a bug and gives the user nothing to act
    // on. `supportable` is the honest answer to "so what should I pass?" —
    // and when it is below the floor of 5, say the document simply cannot
    // carry a quiz rather than suggesting an impossible questionCount.
    const supportable = Math.floor(tokens / MIN_TOKENS_PER_QUESTION);
    const detail =
      `it has roughly ${tokens.toLocaleString('en-US')} tokens of quiz-able content, ` +
      `and each question needs about ${MIN_TOKENS_PER_QUESTION}`;
    throw new DocTooShortError(
      supportable >= 5
        ? `reduce questionCount to ${supportable} or fewer — ${detail}`
        : `this document is too short to build a quiz from; try a longer one — ${detail}`,
    );
  }
}
