export function neutralize(rawMarkdown: string): string {
  return (
    rawMarkdown
      .normalize('NFKC')
      // Matching control characters IS the point here (FR-15): C0/C1 controls
      // other than \t \n \r are stripped as part of the Trojan Source defense.
      // `no-control-regex` exists to catch control chars entering a pattern by
      // ACCIDENT; in this one expression they are the deliberate target.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u0080-\u009F]/g, '')
      .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]/g, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<(iframe|frame|object|embed|applet)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<\/?(?:iframe|frame|object|embed|applet)\b[^>]*>/gi, '')
      .replace(/<meta\b(?=[^>]*http-equiv\s*=\s*["'](?:refresh|set-cookie)["'])[^>]*>/gi, '')
      .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(
        /\s(?:href|src)\s*=\s*(?:"\s*(?:javascript:|data:text\/html)[^"]*"|'\s*(?:javascript:|data:text\/html)[^']*'|(?:javascript:|data:text\/html)[^\s>]+)/gi,
        '',
      )
      .replace(/data:(?:image|application)\/[^;,]+;base64,[A-Za-z0-9+/=]+/gi, '')
  );
}
