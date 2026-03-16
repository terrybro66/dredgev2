export function deduplicateRows(
  rows: Record<string, unknown>[],
  keyFields: string[],
): Record<string, unknown>[] {
  if (keyFields.length === 0) return rows;

  const seen = new Set<string>();
  return rows.filter((row) => {
    // If any key field is missing, treat as unique — don't deduplicate
    const hasAllKeys = keyFields.every((f) => row[f] !== undefined);
    if (!hasAllKeys) return true;

    const key = keyFields.map((f) => String(row[f])).join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
