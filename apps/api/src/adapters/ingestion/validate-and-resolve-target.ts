import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { domainToUnicode } from 'node:url';

import { SsrfBlockedError } from '../../domain/quiz/errors/ssrf-blocked.error.js';
import {
  isBlockedHostname,
  isBlockedIpv4,
  isBlockedIpv6,
  normalizeIpv4MappedIpv6,
} from './ip-blocklist.js';

export type ResolvedTarget = {
  ip: string;
  hostname: string;
  port: number;
  protocol: 'http:' | 'https:';
};
type Lookup = typeof lookup;
function hasMixedScripts(hostname: string): boolean {
  const decoded = domainToUnicode(hostname);
  return /[a-z]/i.test(decoded) && /[\u0400-\u04ff]/.test(decoded);
}
export async function validateAndResolveTarget(
  input: string,
  deps: { resolveHostname?: Lookup } = {},
): Promise<ResolvedTarget> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SsrfBlockedError('invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new SsrfBlockedError('scheme is not allowed');
  if (isBlockedHostname(url.hostname) || hasMixedScripts(url.hostname))
    throw new SsrfBlockedError('hostname is blocked');
  const literal = normalizeIpv4MappedIpv6(url.hostname.replace(/^\[|\]$/g, ''));
  const addresses = isIP(literal)
    ? [{ address: literal, family: isIP(literal) }]
    : await (deps.resolveHostname ?? lookup)(url.hostname, { all: true });
  if (addresses.length === 0) throw new SsrfBlockedError('hostname did not resolve');
  for (const answer of addresses) {
    const address = normalizeIpv4MappedIpv6(answer.address);
    if (isBlockedIpv4(address) || isBlockedIpv6(address))
      throw new SsrfBlockedError('target IP is blocked');
  }
  const ip = normalizeIpv4MappedIpv6(addresses[0]!.address);
  return Object.freeze({
    ip,
    hostname: url.hostname,
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    protocol: url.protocol as 'http:' | 'https:',
  });
}
