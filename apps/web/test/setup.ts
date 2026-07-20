import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Polyfill crypto.randomUUID for jsdom environments where it's missing.
const testCrypto = globalThis.crypto as Crypto & {
  randomUUID?: () => `${string}-${string}-${string}-${string}-${string}`;
};
if (typeof testCrypto.randomUUID !== 'function') {
  testCrypto.randomUUID = (): `${string}-${string}-${string}-${string}-${string}` => {
    const hex = (n: number): string =>
      Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}` as `${string}-${string}-${string}-${string}-${string}`;
  };
}

// Polyfill matchMedia for jsdom — needed by `useReducedMotion` (motion/react,
// consumed by Story 3.2's `ScoreDisplay`) and by any future
// prefers-color-scheme reads. Defaults to "no preference" (matches: false);
// individual tests override via `vi.spyOn(window, 'matchMedia')` when they
// need to exercise the reduced-motion / dark-mode branch.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
