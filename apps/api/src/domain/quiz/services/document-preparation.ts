import { chunkDocument } from './chunker.js';
import {
  assertContentDensity,
  assertDocByteSize,
  assertModelContextWindow,
  assertTokenEstimateCeiling,
} from './doc-size-guard.js';
import { neutralize } from './neutralize.js';
import { estimateTokens } from './token-estimate.js';

export function prepareDocumentForGeneration(
  rawMarkdown: string,
  params: { questionCount: number; contextWindowTokens: number },
): { neutralizedText: string; estimatedTokens: number; chunks: string[] } {
  assertDocByteSize(rawMarkdown);
  const rawTokens = estimateTokens(rawMarkdown);
  assertTokenEstimateCeiling(rawTokens);
  assertModelContextWindow(rawTokens, params.contextWindowTokens);
  const neutralizedText = neutralize(rawMarkdown);
  const estimatedTokens = estimateTokens(neutralizedText);
  assertContentDensity(estimatedTokens, params.questionCount);
  return Object.freeze({
    neutralizedText,
    estimatedTokens,
    chunks: chunkDocument(neutralizedText),
  });
}
