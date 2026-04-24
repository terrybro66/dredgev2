import type { QueryRow } from "../types";

/**
 * TableView — generic column-sniffing table for any domain's query rows.
 * Strips `raw` and `extras` from display columns, caps at 50 rows.
 * Supports an optional active filter with a clear button.
 */
export function TableView({
  rows,
  activeFilter,
  onClearFilter,
}: {
  rows: QueryRow[];
  activeFilter?: { field: string; value: string };
  onClearFilter?: () => void;
}) {
  const filtered = activeFilter
    ? (rows as Record<string, unknown>[]).filter(
        (r) => String(r[activeFilter.field] ?? "") === activeFilter.value,
      )
    : (rows as Record<string, unknown>[]);

  const capped = filtered.slice(0, 50);
  const columns =
    capped.length > 0
      ? Object.keys(capped[0])
          .filter((k) => k !== "raw" && k !== "extras")
          .slice(0, 6)
      : [];

  return (
    <div className="table-wrapper">
      {activeFilter && (
        <div className="filter-bar">
          <span className="filter-label">
            Filtered: <strong>{activeFilter.field}</strong> ={" "}
            <strong>{activeFilter.value}</strong> ({filtered.length} of{" "}
            {rows.length})
          </span>
          {onClearFilter && (
            <button className="btn-ghost small" onClick={onClearFilter}>
              ✕ Clear filter
            </button>
          )}
        </div>
      )}
      <table className="result-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{col.replace(/_/g, " ")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {capped.map((r, i) => (
            <tr key={(r.id as string) ?? i}>
              {columns.map((col) => (
                <td key={col}>{r[col] != null ? String(r[col]) : "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > 50 && (
        <div className="table-cap-note">
          Showing 50 of {filtered.length} results
          {activeFilter ? " (filtered)" : ""}
        </div>
      )}
    </div>
  );
}
