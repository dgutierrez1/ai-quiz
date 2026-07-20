export function chunkDocument(neutralizedText: string): string[] {
  const lines = neutralizedText
    .split(/(?=^#{2,3}\s+)/m)
    .map((part) => part.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [neutralizedText];
}
