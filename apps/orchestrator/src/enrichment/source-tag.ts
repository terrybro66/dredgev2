export function tagRows(
  rows: unknown[],
  sourceUrl: string,
): Record<string, unknown>[] {
  return rows.map((row) => ({
    ...(row as Record<string, unknown>),
    _sourceTag: sourceUrl,
  }));
}
