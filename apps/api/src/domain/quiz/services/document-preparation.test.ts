import { describe, expect, it } from 'vitest';

import { prepareDocumentForGeneration } from './document-preparation.js';

describe('prepareDocumentForGeneration', () => {
  it('rejects oversized inputs', () => {
    const huge = 'a'.repeat(3 * 1024 * 1024);
    expect(() =>
      prepareDocumentForGeneration(huge, { questionCount: 1, contextWindowTokens: 64_000 }),
    ).toThrow();
  });
  it('returns neutralized text and chunks', () => {
    const md =
      `## Heading
<script>alert(1)</script>\nActual content with enough prose so density checks pass.\n` +
      'lorem ipsum '.repeat(200);
    const out = prepareDocumentForGeneration(md, { questionCount: 1, contextWindowTokens: 64_000 });
    expect(out.neutralizedText).not.toContain('<script>');
    expect(out.chunks.length).toBeGreaterThanOrEqual(1);
  });
});
