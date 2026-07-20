import type { GeneratedQuestionDto } from '@ai-quiz/shared';

/**
 * Optional enrichment seam for Story 2.6 — given a generated quiz, produce
 * explanation polish, hint metadata, or follow-up chat primers. The default
 * implementation is a no-op so the canonical v1 pipeline never depends on
 * a provider call.
 */
export interface EnrichmentPort {
  enrich(input: {
    readonly questions: readonly GeneratedQuestionDto[];
    readonly topic?: string;
  }): Promise<Readonly<GeneratedQuestionDto[]>>;
}

export const ENRICHMENT_PORT = Symbol('EnrichmentPort');

export class NoopEnrichment implements EnrichmentPort {
  public async enrich(input: {
    readonly questions: readonly GeneratedQuestionDto[];
    readonly topic?: string;
  }): Promise<Readonly<GeneratedQuestionDto[]>> {
    return Object.freeze([...input.questions]);
  }
}
