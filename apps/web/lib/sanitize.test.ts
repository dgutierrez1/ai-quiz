import { describe, expect, it } from 'vitest';

import { sanitizeChatHtml, sanitizeExplanationHtml } from './sanitize';

describe('sanitizeChatHtml', () => {
  it('strips a <script> payload from markdown-derived HTML', () => {
    const result = sanitizeChatHtml('Hello <script>alert(1)</script> world');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('alert(1)');
  });

  it('forces rel="noopener noreferrer" on an injected target="_blank" link', () => {
    const md = 'Visit <a href="https://example.com" target="_blank">this link</a> for details.';
    const result = sanitizeChatHtml(md);
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it('does not add rel to a link with no target="_blank"', () => {
    const md = '<a href="https://example.com">plain link</a>';
    const result = sanitizeChatHtml(md);
    expect(result).not.toContain('rel=');
  });

  it('renders markdown formatting (bold, lists) as HTML', () => {
    const result = sanitizeChatHtml('**bold** text\n\n- one\n- two');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<li>one</li>');
  });

  it('drops disallowed attributes such as onerror', () => {
    const result = sanitizeChatHtml('<img src="x" onerror="alert(1)">');
    expect(result).not.toContain('onerror');
    // <img> itself isn't in ALLOWED_TAGS either — dropped entirely.
    expect(result).not.toContain('<img');
  });

  it('returns an empty string when window is undefined (SSR guard)', () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error -- simulating an SSR render pass with no DOM.
    delete globalThis.window;
    try {
      expect(sanitizeChatHtml('**bold**')).toBe('');
    } finally {
      globalThis.window = originalWindow;
    }
  });
});

describe('sanitizeExplanationHtml', () => {
  it('shares the same sanitization behavior as sanitizeChatHtml', () => {
    const result = sanitizeExplanationHtml('Hello <script>alert(1)</script> world');
    expect(result).not.toContain('<script');
  });
});
