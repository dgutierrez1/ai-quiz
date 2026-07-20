'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

import { ThemeProvider } from '../lib/theme-context';
import { UserProvider } from '../lib/user-context';
interface ProvidersProps {
  readonly children: React.ReactNode;
}

/**
 * Providers (Story 2.7) — wraps the client tree with QueryClientProvider,
 * ThemeProvider, and UserProvider.
 *
 * QueryClient is created lazily and held in a ref via `useState` so that
 * each browser session gets exactly one instance and React StrictMode
 * double-mount does not produce two. The TanStack Query defaults here are
 * tuned for the slow-generation UX: retries are disabled (we never want a
 * duplicate `POST /sessions` against the 5/min cap), and a 30 s timeout
 * covers the 5–30s sync window without cutting off longer docs.
 */
export function Providers({ children }: ProvidersProps): React.JSX.Element {
  const [client] = useState<QueryClient>(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <UserProvider>
        <ThemeProvider>{children}</ThemeProvider>
      </UserProvider>
    </QueryClientProvider>
  );
}
