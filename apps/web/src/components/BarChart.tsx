import type { QueryRow } from "../types";

/**
 * BarChart — counts results by month/date and renders a vertical bar per period.
 * Works for any domain: detects whether rows use `month` (crime-uk) or `date`
 * (all other domains) and normalises to YYYY-MM before bucketing.
 */
export function BarChart({
  rows,
  months,
}: {
  rows: QueryRow[];
  months: string[];
}) {
  const dateField = rows.length > 0 && "month" in rows[0] ? "month" : "date";
  const counts: Record<string, number> = {};
  for (const m of months) counts[m] = 0;
  for (const r of rows) {
    const key = (r as any)[dateField];
    if (typeof key === "string") {
      const ym = key.slice(0, 7);
      if (ym in counts) counts[ym]++;
    }
  }
  const max = Math.max(...Object.values(counts), 1);

  return (
    <div className="bar-chart">
      {months.map((month) => {
        const count = counts[month] ?? 0;
        return (
          <div key={month} className="bar-col">
            <div className="bar-count">{count}</div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ height: `${(count / max) * 100}%` }}
              />
            </div>
            <div className="bar-label">
              {month.slice(5)}/{month.slice(2, 4)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
