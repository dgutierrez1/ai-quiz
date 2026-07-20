import type { IngestedDocumentDto } from '@ai-quiz/shared';
import { IngestedDocumentSchema } from '@ai-quiz/shared';

// A generation-pipeline test that boots the real Nest app must never require
// real network access. The content is:
//   - sized well above the 500 tokens/question density floor for the max
//     questionCount (8), i.e. >= ~4000 estimated tokens total;
//   - split (via `##` headings) into three chunks each comfortably under the
//     8000-token chunk-selection budget, so `selectChunkBudget` never has to
//     skip one for being individually oversized;
//   - full of shared vocabulary so the fake LLM's category-tagged pool
//     (derived directly from these chunks) passes the grounding check.
// These constraints are load-bearing — changing the text can fail the
// generation pipeline in ways that look unrelated to this file.
const FIXTURE_PARAGRAPH =
  'The deterministic fixture document stands in for a real markdown source during automated tests, so ' +
  'generation never depends on real network access or a live provider. It describes a small quiz-able domain ' +
  'that repeats enough shared vocabulary — fixture, deterministic, markdown, generation, pipeline, quiz, ' +
  'category, question, answer, source, chunk, document — that grounding checks pass for any question the mock ' +
  'LLM derives from it. ';

function buildFixtureSection(name: string): string {
  return `## Category ${name}\n\n${FIXTURE_PARAGRAPH.repeat(20)}`;
}

export function buildDeterministicFixture(url: string): IngestedDocumentDto {
  const body = ['Alpha', 'Beta', 'Gamma'].map(buildFixtureSection).join('\n\n');
  return {
    url,
    content: body,
    contentType: 'text/markdown',
    byteSize: Buffer.byteLength(body, 'utf8'),
  };
}

/**
 * Fake `IngestionPort`.
 *
 * NOTE: this bypasses the real adapter's SSRF/DNS-rebind guard
 * (`validateAndResolveTarget`) and size cap (`streamFetchWithCap`) — as any
 * fake necessarily would. Those guards therefore need their own direct unit
 * coverage; they are NOT exercised by any suite that injects this double.
 */
export class FakeIngestionAdapter {
  /** When set, returned instead of the derived fixture. */
  public document: Readonly<IngestedDocumentDto> | null = null;
  /** Every URL the pipeline asked for, in order. */
  public readonly requestedUrls: string[] = [];

  public reset(): void {
    this.document = null;
    this.requestedUrls.length = 0;
  }

  public async fetchMarkdown(requestedUrl: string): Promise<Readonly<IngestedDocumentDto>> {
    this.requestedUrls.push(requestedUrl);
    if (this.document) return this.document;
    return Object.freeze(IngestedDocumentSchema.parse(buildDeterministicFixture(requestedUrl)));
  }
}
