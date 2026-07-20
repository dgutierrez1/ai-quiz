import type { QuizSessionProvider } from '@ai-quiz/shared';

/**
 * Provider/model catalog (Story 2.7).
 *
 * The actual list of models comes from `GET /api/config/providers` — see
 * `useProvidersQuery()`. This module only owns the v1 default-model map and
 * the list of v1 provider ids, both of which mirror `provider-matrix.ts`
 * in the API. They are used as fallbacks when the live query has not yet
 * resolved and as the source of truth for the model reset behavior
 * (provider change resets the model to that provider's default).
 */

export const V1_PROVIDERS: readonly QuizSessionProvider[] = ['minimax', 'openrouter'] as const;

export const DEFAULT_MODEL_BY_PROVIDER: Readonly<Record<QuizSessionProvider, string>> = {
  minimax: 'MiniMax-M3',
  openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
};

/**
 * Resolve the model list for a provider from the live `ProviderListResponse`,
 * falling back to the v1 default if the live catalog did not include an
 * entry for the provider. Used by `provider-model-select.tsx`.
 */
export function modelsForProvider(
  providers: Partial<Record<QuizSessionProvider, readonly string[]>> | undefined,
  provider: QuizSessionProvider,
): readonly string[] {
  const list = providers?.[provider];
  if (list && list.length > 0) return list;
  const fallback = DEFAULT_MODEL_BY_PROVIDER[provider];
  return [fallback];
}

export function defaultModelForProvider(
  providers: Partial<Record<QuizSessionProvider, readonly string[]>> | undefined,
  provider: QuizSessionProvider,
): string {
  const list = modelsForProvider(providers, provider);
  return list[0] ?? DEFAULT_MODEL_BY_PROVIDER[provider];
}
