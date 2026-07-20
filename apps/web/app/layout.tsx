import './globals.css';

import type { Metadata } from 'next';

import { Providers } from './providers';
export const metadata: Metadata = {
  title: 'ai-quiz',
  description: 'Turn any public document into a grounded comprehension quiz.',
};

/**
 * The UUID-v4 inline script MUST run before React hydrates (Story 2.7 AC #2).
 * It writes to localStorage only when no id is already present — never
 * overwrites an existing id, which is what would otherwise fragment history
 * on every page refresh.
 *
 * The script is intentionally minimal: no module imports, no deps. It
 * survives CSP `unsafe-inline` because that is the recommended pattern for
 * the pre-hydration bootstrap, and the generated UUID is the user's
 * browser-only identity (no PII).
 */
const uuidBootstrap = `
(function () {
  try {
    var key = 'ai-quiz.user.id';
    var existing = window.localStorage.getItem(key);
    var isUuidV4 = function (s) {
      return typeof s === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
    };
    if (!isUuidV4(existing)) {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        window.localStorage.setItem(key, crypto.randomUUID());
      }
    }
  } catch (_) {
    /* localStorage unavailable — the user id stays empty; UI must still render */
  }
})();
`;

export default function RootLayout({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: uuidBootstrap }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
