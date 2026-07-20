import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { streamFetchWithCap } from '../../../src/adapters/ingestion/stream-fetch-with-cap.js';
import type { ResolvedTarget } from '../../../src/adapters/ingestion/validate-and-resolve-target.js';
import { DocTooLargeError } from '../../../src/domain/quiz/errors/doc-too-large.error.js';

describe('scratch stream-fetch-with-cap', () => {
  let server: ReturnType<typeof createServer>;
  let port: number;

  function start(handler: Parameters<typeof createServer>[0]) {
    return new Promise<void>((resolve) => {
      server = createServer(handler);
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('fetches under-cap content successfully', async () => {
    await start((req, res) => {
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
      res.end('# hello world');
    });
    const target: ResolvedTarget = { ip: '127.0.0.1', hostname: 'example.com', port, protocol: 'http:' };
    const result = await streamFetchWithCap(target, `http://example.com:${port}/doc.md`);
    console.log('RESULT:', result);
    expect(result.content).toBe('# hello world');
  });

  it('rejects over-cap with DocTooLargeError', async () => {
    await start((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      const chunk = Buffer.alloc(1024 * 1024, 'a');
      let sent = 0;
      const interval = setInterval(() => {
        if (sent > 11 * 1024 * 1024) {
          clearInterval(interval);
          res.end();
          return;
        }
        res.write(chunk);
        sent += chunk.length;
      }, 0);
    });
    const target: ResolvedTarget = { ip: '127.0.0.1', hostname: 'example.com', port, protocol: 'http:' };
    await expect(streamFetchWithCap(target, `http://example.com:${port}/doc.md`)).rejects.toBeInstanceOf(DocTooLargeError);
  });

  it('rejects unsupported content-type', async () => {
    await start((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    const target: ResolvedTarget = { ip: '127.0.0.1', hostname: 'example.com', port, protocol: 'http:' };
    await expect(streamFetchWithCap(target, `http://example.com:${port}/doc.md`)).rejects.toThrow('unsupported content type');
  });
});
