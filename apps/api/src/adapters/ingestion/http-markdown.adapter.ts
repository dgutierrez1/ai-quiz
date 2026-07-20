import { IngestedDocumentSchema } from '@ai-quiz/shared';

import type { IngestionPort } from '../../domain/ports/ingestion.port.js';
import { rewriteGithubBlobUrl } from './github-blob-to-raw.js';
import { streamFetchWithCap } from './stream-fetch-with-cap.js';
import { validateAndResolveTarget } from './validate-and-resolve-target.js';

/**
 * The real ingestion adapter, and only the real one.
 *
 * There is deliberately no test branch here. The previous `NODE_ENV === 'test'`
 * fixture shortcut returned BEFORE `validateAndResolveTarget`, which meant the
 * SSRF / DNS-rebind guard and the size cap were never exercised end-to-end by
 * any suite that booted the app — the guards were effectively dead code under
 * test. Substituting a fake now happens at the container boundary via
 * `AI_QUIZ_FAKE_ADAPTERS` (see `adapters.module.ts`).
 */
export class HttpMarkdownAdapter implements IngestionPort {
  public async fetchMarkdown(requestedUrl: string) {
    const url = rewriteGithubBlobUrl(requestedUrl);
    const target = await validateAndResolveTarget(url);
    const result = await streamFetchWithCap(target, url);
    return Object.freeze(IngestedDocumentSchema.parse({ url, ...result }));
  }
}
