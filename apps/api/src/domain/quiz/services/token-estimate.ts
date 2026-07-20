export const TOKEN_ESTIMATE_BYTES_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / TOKEN_ESTIMATE_BYTES_PER_TOKEN);
}
