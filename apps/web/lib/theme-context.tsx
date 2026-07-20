'use client';
import { createContext, useContext, useMemo } from 'react';

import { useLocalStorage } from './use-local-storage';
/**
 * ThemeProvider / useTheme (Story 2.7).
 *
 * Default follows `prefers-color-scheme` until the user overrides via
 * `setTheme`. No toggle UI ships in Story 2.7 (no AC requires one) but the
 * hook surface is set up so Stories 3.x can drop one in without touching
 * the provider.
 *
 * The provider writes only the user's explicit override to localStorage
 * (`'light'` / `'dark'`); the absence of an override means "follow system".
 */
export type ThemeChoice = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  readonly theme: ThemeChoice;
  readonly setTheme: (next: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  readonly children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps): React.JSX.Element {
  const [theme, setTheme] = useLocalStorage<ThemeChoice>('ai-quiz.theme', 'system');

  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
