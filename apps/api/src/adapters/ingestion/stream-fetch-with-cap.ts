import { Agent, errors, request } from 'undici';

import { DocTooLargeError } from '../../domain/quiz/errors/doc-too-large.error.js';
import { IngestTimeoutError } from '../../domain/quiz/errors/ingest-timeout.error.js';
import { SsrfBlockedError } from '../../domain/quiz/errors/ssrf-blocked.error.js';
import type { ResolvedTarget } from './validate-and-resolve-target.js';

const MAX_BODY_BYTES = 10 * 1024 * 1024;
export async function streamFetchWithCap(
  target: ResolvedTarget,
  originalUrl: string,
): Promise<{ content: string; contentType: string; byteSize: number }> {
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, _options, callback) =>
        callback(null, [{ address: target.ip, family: target.ip.includes(':') ? 6 : 4 }]),
    },
  });
  try {
    const response = await request(originalUrl, {
      dispatcher,
      headers: { host: target.hostname },
      headersTimeout: 10_000,
      bodyTimeout: 10_000,
    });
    if (response.statusCode >= 300 && response.statusCode < 400)
      throw new SsrfBlockedError('redirects are disabled');
    const contentType = String(response.headers['content-type'] ?? '')
      .split(';')[0]!
      .trim()
      .toLowerCase();
    if (contentType !== 'text/markdown' && contentType !== 'text/plain')
      throw new SsrfBlockedError('unsupported content type');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_BODY_BYTES) {
        response.body.destroy();
        throw new DocTooLargeError('HTTP body exceeds 10 MiB');
      }
      chunks.push(bytes);
    }
    return { content: Buffer.concat(chunks).toString('utf8'), contentType, byteSize: size };
  } catch (error) {
    if (error instanceof DocTooLargeError || error instanceof SsrfBlockedError) throw error;
    if (error instanceof errors.HeadersTimeoutError || error instanceof errors.BodyTimeoutError)
      throw new IngestTimeoutError('markdown fetch timed out');
    throw new SsrfBlockedError('invalid HTTP response');
  } finally {
    await dispatcher.close();
  }
}
