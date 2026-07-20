// apps/api/test/security/ip-tracker.security.test.ts
//
// Story 5.3 AC #9 / Task 4 — closes Story 1.5's Open Question #3. Proves
// `IpThrottlerGuard.getTracker(req)`:
//   (a) reads `Fly-Client-IP` when present, and IGNORES a client-supplied
//       `X-Forwarded-For` even when it disagrees with `Fly-Client-IP` — the
//       whole point being that a spoofable header must never be able to
//       shift an attacker's rate-limit bucket;
//   (b) falls back to the raw socket address when `Fly-Client-IP` is absent
//       (local dev / CI / non-Fly environments) — never to `X-Forwarded-For`.
//
// This is a unit test against the guard directly (constructing a minimal
// fake `req`), not an HTTP integration test — `getTracker` is a protected
// method reached via `Reflect` here so the test can call it without driving
// a full request through the throttler storage layer, mirroring how
// `@nestjs/throttler`'s own test suite unit-tests `getTracker` in
// isolation.

import { describe, expect, it } from 'vitest';

import { IpThrottlerGuard } from '../../src/driving/middleware/ip-throttler.guard.js';

// `getTracker` only reads `req.headers` / `req.socket.remoteAddress` — no
// DI dependencies are exercised, so `Object.create(IpThrottlerGuard.prototype)`
// is enough to invoke the method without wiring up the full Nest throttler
// module (options/storageService/reflector), none of which `getTracker`
// touches.
function callGetTracker(req: Record<string, unknown>): Promise<string> {
  const guard = Object.create(IpThrottlerGuard.prototype) as IpThrottlerGuard;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reaching a protected method for a unit test on the guard itself
  return (guard as any).getTracker(req) as Promise<string>;
}

describe('IpThrottlerGuard.getTracker (Story 5.3 AC #9)', () => {
  it('resolves to Fly-Client-IP when present', async () => {
    const req = {
      headers: { 'fly-client-ip': '203.0.113.7' },
      socket: { remoteAddress: '10.0.0.5' },
    };
    await expect(callGetTracker(req)).resolves.toBe('203.0.113.7');
  });

  it('ignores a client-supplied X-Forwarded-For even when it disagrees with Fly-Client-IP', async () => {
    const req = {
      headers: {
        'fly-client-ip': '203.0.113.7',
        'x-forwarded-for': '198.51.100.99, 1.1.1.1', // attacker-chosen, disagreeing value
      },
      socket: { remoteAddress: '10.0.0.5' },
    };
    const tracker = await callGetTracker(req);
    expect(tracker).toBe('203.0.113.7');
    expect(tracker).not.toBe('198.51.100.99');
    expect(tracker).not.toContain('1.1.1.1');
  });

  it('falls back to the socket remote address when Fly-Client-IP is absent (local dev / CI)', async () => {
    const req = {
      headers: { 'x-forwarded-for': '198.51.100.99' }, // must NOT be trusted as a fallback either
      socket: { remoteAddress: '127.0.0.1' },
    };
    const tracker = await callGetTracker(req);
    expect(tracker).toBe('127.0.0.1');
    expect(tracker).not.toBe('198.51.100.99');
  });

  it('falls back to "unknown" when neither Fly-Client-IP nor a socket address is available', async () => {
    const req = { headers: {}, socket: {} };
    await expect(callGetTracker(req)).resolves.toBe('unknown');
  });
});

describe('main.ts never enables Express trust proxy (Story 5.3 AC #9)', () => {
  it('the source of main.ts contains no trust proxy configuration', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const mainTsPath = fileURLToPath(new URL('../../src/main.ts', import.meta.url));
    const source = readFileSync(mainTsPath, 'utf8');
    expect(source).not.toMatch(/trust proxy/i);
    expect(source).not.toMatch(/trustProxy/);
  });

  it('no source file actually READS the x-forwarded-for header (comments mentioning it, e.g. to document why it is ignored, are fine)', async () => {
    const { execFileSync } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const srcDir = fileURLToPath(new URL('../../src', import.meta.url));
    let output = '';
    try {
      // Matches an actual property/header access, not a prose mention:
      // headers['x-forwarded-for'], headers["x-forwarded-for"], headers.get('x-forwarded-for').
      output = execFileSync(
        'grep',
        [
          '-rilE',
          '--include=*.ts',
          'headers(\\.get\\()?\\(?[\'"\\[]x-forwarded-for[\'"\\]]',
          srcDir,
        ],
        { encoding: 'utf8' },
      );
    } catch (err) {
      // grep exits 1 when no matches are found — that's the desired state.
      const e = err as { status?: number };
      if (e.status !== 1) throw err;
    }
    expect(output.trim()).toBe('');
  });
});
