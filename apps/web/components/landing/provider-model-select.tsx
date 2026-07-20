'use client';

import type { QuizSessionProvider } from '@ai-quiz/shared';

interface ProviderModelSelectProps {
  readonly providers: ReadonlyArray<QuizSessionProvider>;
  readonly provider: QuizSessionProvider;
  readonly modelsFor: (provider: QuizSessionProvider) => readonly string[];
  readonly defaultModelFor: (provider: QuizSessionProvider) => string;
  readonly model: string;
  readonly onProviderChange: (next: QuizSessionProvider) => void;
  readonly onModelChange: (next: string) => void;
  readonly disabled?: boolean;
  readonly describedBy?: string;
}

/**
 * ProviderModelSelect (Story 2.7 AC #4, #5).
 *
 * The model select is dependent on the provider. Changing the provider
 * resets the model to that provider's default — this is a behavior of
 * the surrounding form (`session-form.tsx`), not of this component, so
 * the component itself stays a controlled pair.
 */
export function ProviderModelSelect({
  providers,
  provider,
  modelsFor,
  defaultModelFor,
  model,
  onProviderChange,
  onModelChange,
  disabled = false,
  describedBy,
}: ProviderModelSelectProps): React.JSX.Element {
  const modelList = modelsFor(provider);
  const defaultModel = defaultModelFor(provider);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="provider-select" className="text-sm font-medium text-[var(--color-ink)]">
          Provider
        </label>
        <select
          id="provider-select"
          data-testid="provider-select"
          value={provider}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => onProviderChange(event.target.value as QuizSessionProvider)}
          className="min-h-[44px] rounded-md border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] px-3 text-[var(--color-ink)]"
        >
          {providers.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="model-select" className="text-sm font-medium text-[var(--color-ink)]">
          Model
        </label>
        <select
          id="model-select"
          data-testid="model-select"
          value={model}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => {
            const next = event.target.value;
            if (next === '__default__') {
              onModelChange(defaultModel);
            } else {
              onModelChange(next);
            }
          }}
          className="min-h-[44px] rounded-md border border-[var(--color-surface-sunken)] bg-[var(--color-surface-raised)] px-3 text-[var(--color-ink)]"
        >
          {!modelList.includes(model) && (
            <option value={defaultModel}>{defaultModel} (default)</option>
          )}
          {modelList.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
