import { estimateTokens } from './token-estimate.js';
export function selectChunkBudget(chunks: readonly string[], tokenBudget = 8000): string[] {
  const out: string[] = [];
  let used = 0;
  for (const chunk of chunks) {
    const cost = estimateTokens(chunk);
    if (used + cost > tokenBudget) continue;
    out.push(chunk);
    used += cost;
  }
  return out;
}
