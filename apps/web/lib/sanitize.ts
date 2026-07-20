import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * sanitize.ts (Story 4.3 Task 2) — the single DOMPurify wrapper for the web
 * app. First story to need it (deferred by Story 2.7).
 *
 * Two exports, ONE shared implementation:
 *   - `sanitizeChatHtml`        — called from exactly one place,
 *     `chat-message.tsx`'s assistant branch (AD-N1).
 *   - `sanitizeExplanationHtml` — handed back to Story 3.2 for rendering
 *     `questions.explanation`. Story 3.2 MUST import this rather than
 *     forking a second DOMPurify call — question/answer *text* itself
 *     still renders as auto-escaping plain text (`{text}`), never through
 *     this function; only the free-form `explanation` prose is markdown.
 *
 * Security boundary (AD-N1, project-context.md § Security Rules item 5):
 * this file is the ONLY place DOMPurify runs in the web app. User chat
 * content and all question/answer text must never be passed through it —
 * that split is enforced at the call-site level in `chat-message.tsx`.
 */

const CHAT_SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'em',
    'ul',
    'ol',
    'li',
    'a',
    'code',
    'pre',
    'blockquote',
    'h1',
    'h2',
    'h3',
    'h4',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  // Story Dev Notes list `['href', 'title']` verbatim, but also mandate the
  // afterSanitizeAttributes hook below "forcing rel=noopener noreferrer on
  // any target=_blank" — citing the cure53/DOMPurify demo pattern, whose
  // ALLOWED_ATTR always includes `target` alongside that hook. DOMPurify
  // strips disallowed attributes (including `target`) BEFORE
  // afterSanitizeAttributes runs, so without `target` here the hook could
  // never observe a `target="_blank"` to act on — the two instructions are
  // only jointly satisfiable with `target` included. Added here as the
  // resolution; `rel` itself is deliberately NOT allow-listed since it is
  // only ever hook-set, never author-controlled.
  ALLOWED_ATTR: ['href', 'title', 'target'],
  ALLOW_DATA_ATTR: false,
};

let hookInstalled = false;

function ensureRelHook(): void {
  if (hookInstalled) return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  hookInstalled = true;
}

/**
 * markdown -> HTML (`marked`) -> sanitized HTML (`DOMPurify`).
 *
 * SSR guard: DOMPurify requires a live DOM. A `'use client'` component is
 * still rendered once on the server for the initial HTML before hydration;
 * calling the DOMPurify factory's `.sanitize()` at that point would throw
 * (or on this DOMPurify build, silently be undefined — `isSupported` is
 * `false` and `.sanitize` is never attached when `window` is absent at
 * module-eval time). Returning `''` during SSR is safe here: chat and
 * explanation content is only ever fetched client-side after hydration, so
 * there is nothing to sanitize during the SSR pass in the first place.
 */
function markdownToSanitizedHtml(markdown: string): string {
  if (typeof window === 'undefined') {
    return '';
  }
  ensureRelHook();
  const html = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(html, CHAT_SANITIZE_CONFIG);
}

export function sanitizeChatHtml(markdown: string): string {
  return markdownToSanitizedHtml(markdown);
}

export function sanitizeExplanationHtml(markdown: string): string {
  return markdownToSanitizedHtml(markdown);
}
