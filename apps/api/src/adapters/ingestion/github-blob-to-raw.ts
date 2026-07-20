export function rewriteGithubBlobUrl(input: string): string {
  const url = new URL(input);
  if (url.hostname !== 'github.com') return input;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 5 || parts[2] !== 'blob') return input;
  return `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts.slice(3).join('/')}`;
}
