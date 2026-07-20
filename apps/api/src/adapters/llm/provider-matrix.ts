// Provider capability matrix (Story 2.3). Only the v1 supported models are
// listed; adding a new provider/model must change this file *and* the smoke
// check story so the docs and tests stay in sync.
export type ProviderId = 'minimax' | 'openrouter';
export interface ModelDescriptor {
  readonly id: string;
  readonly contextWindow: number;
  readonly free: boolean;
}
export const PROVIDER_MATRIX: Readonly<Record<ProviderId, readonly ModelDescriptor[]>> = {
  minimax: [{ id: 'MiniMax-M3', contextWindow: 64_000, free: false }],
  openrouter: [
    { id: 'meta-llama/llama-3.3-70b-instruct:free', contextWindow: 131_072, free: true },
    { id: 'qwen/qwen-2.5-72b-instruct:free', contextWindow: 131_072, free: true },
  ],
};
export function resolveProvider(provider: ProviderId, modelId: string): ModelDescriptor {
  const found = PROVIDER_MATRIX[provider].find((m) => m.id === modelId);
  if (!found) throw new Error(`unsupported model ${provider}/${modelId}`);
  return found;
}
