import { isIP } from 'node:net';

export const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  'metadata.google.internal',
  'metadata.amazonaws.com',
]);
export const IPV4_BLOCKS = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xe0000000, 4],
  [0xf0000000, 4],
] as const;

function ipv4Number(ip: string): number | null {
  let value = ip;
  if (isIP(value) !== 4) {
    if (/^\d+$/.test(value)) {
      const numeric = Number(value);
      if (numeric < 0 || numeric > 0xffffffff) return null;
      return numeric >>> 0;
    }
    const short = value.split('.').map(Number);
    if (short.length === 2 && short.every((x) => Number.isInteger(x) && x >= 0 && x <= 255))
      value = `${short[0]}.0.0.${short[1]}`;
  }
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return null;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}
export function normalizeIpv4MappedIpv6(ip: string): string {
  return ip.toLowerCase().startsWith('::ffff:') ? ip.slice(7) : ip;
}
export function isBlockedIpv4(ip: string): boolean {
  const n = ipv4Number(ip);
  if (n === null) return false;
  return IPV4_BLOCKS.some(([network, prefix]) => n >>> (32 - prefix) === network >>> (32 - prefix));
}
export function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  const mapped = normalizeIpv4MappedIpv6(lower);
  if (mapped !== lower) return isBlockedIpv4(mapped);
  return (
    lower === '::1' ||
    // The unspecified address. Connecting to `::` resolves to loopback on
    // Linux, so omitting it leaves an SSRF hole reachable via an
    // attacker-controlled AAAA record pointing at `::`.
    lower === '::' ||
    lower === '0:0:0:0:0:0:0:0' ||
    lower === '0:0:0:0:0:0:0:1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    /^fe[89ab]/.test(lower) ||
    lower.startsWith('ff') ||
    lower.startsWith('2002:')
  );
}
export function isBlockedHostname(hostname: string): boolean {
  return BLOCKED_HOSTNAMES.has(hostname.toLowerCase());
}
