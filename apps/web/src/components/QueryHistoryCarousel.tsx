/**
 * apps/web/src/components/QueryHistoryCarousel.tsx
 *
 * Fetches recent queries from GET /query/history and renders them as
 * horizontally scrollable cards. Clicking a card re-executes via /execute
 * using handleFollowUp from the Zustand store — no prop drilling needed.
 */

import { useQuery } from "@tanstack/react-query";
import { useDredgeStore } from "../store";
import { API } from "../api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface HistoryEntry {
  query_id: string;
  text: string;
  category: string;
  date_from: string;
  date_to: string;
  resolved_location: string | null;
  poly: string;
  country_code: string | null;
  domain: string;
  intent: string | null;
  viz_hint: string;
  createdAt: string;
  result_count: number | null;
  cache_hit: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMonth(ym: string): string {
  const [year, month] = ym.split("-");
  return new Date(parseInt(year), parseInt(month) - 1).toLocaleString("en-GB", {
    month: "short",
    year: "numeric",
  });
}

function formatCategory(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildMonths(dateFrom: string, dateTo: string): string[] {
  const [fromYear, fromMonth] = dateFrom.split("-").map(Number);
  const [toYear, toMonth] = dateTo.split("-").map(Number);
  const fromTotal = fromYear * 12 + fromMonth;
  const toTotal = toYear * 12 + toMonth;
  const months: string[] = [];
  for (let t = fromTotal; t <= toTotal; t++) {
    const year = Math.floor((t - 1) / 12);
    const month = ((t - 1) % 12) + 1;
    months.push(`${year}-${String(month).padStart(2, "0")}`);
  }
  return months;
}

const VIZ_ICONS: Record<string, string> = {
  map: "◎",
  bar: "▦",
  table: "≡",
  dashboard: "◈",
  heatmap: "◉",
};

// ── QueryHistoryCarousel ──────────────────────────────────────────────────────

export function QueryHistoryCarousel() {
  const executeQuery = useDredgeStore((s) => s.executeQuery);

  const { data: entries = [] } = useQuery<HistoryEntry[]>({
    queryKey: ["query-history"],
    queryFn: () => fetch(`${API}/query/history`).then((r) => r.json()),
    staleTime: 30_000,
  });

  if (entries.length === 0) return null;

  function handleClick(entry: HistoryEntry) {
    if (!executeQuery) return;
    executeQuery({
      plan: {
        category: entry.category,
        date_from: entry.date_from,
        date_to: entry.date_to,
        location: entry.resolved_location ?? entry.text,
      },
      poly: entry.poly,
      viz_hint: entry.viz_hint,
      resolved_location: entry.resolved_location ?? "",
      country_code: entry.country_code ?? "GB",
      intent: entry.intent ?? entry.domain,
      months: buildMonths(entry.date_from, entry.date_to),
    });
  }

  return (
    <div className="history-carousel">
      <div className="history-label">Recent queries</div>
      <div className="history-track">
        {entries.slice(0, 10).map((entry) => (
          <button
            key={entry.query_id}
            className="history-card"
            onClick={() => handleClick(entry)}
            title={entry.text}
          >
            <div className="history-card-top">
              <span className="history-viz-icon">
                {VIZ_ICONS[entry.viz_hint] ?? "·"}
              </span>
              <span className="history-domain">
                {formatCategory(entry.domain)}
              </span>
              {entry.result_count != null && (
                <span className="history-count">{entry.result_count}</span>
              )}
            </div>
            <div className="history-card-location">
              {entry.resolved_location ?? entry.text}
            </div>
            <div className="history-card-date">
              {entry.date_from === entry.date_to
                ? formatMonth(entry.date_from)
                : `${formatMonth(entry.date_from)} – ${formatMonth(entry.date_to)}`}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── CSS ───────────────────────────────────────────────────────────────────────

export const CAROUSEL_CSS = `
  .history-carousel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
  }

  .history-label {
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .history-track {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .history-track::-webkit-scrollbar { height: 3px; }
  .history-track::-webkit-scrollbar-track { background: transparent; }
  .history-track::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .history-card {
    flex-shrink: 0;
    width: 180px;
    background: var(--bg2);
    border: 1px solid var(--border);
    padding: 10px 12px;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .history-card:hover {
    border-color: var(--amber-dim);
    background: var(--bg3);
  }

  .history-card-top {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .history-viz-icon {
    font-size: 12px;
    color: var(--amber);
    flex-shrink: 0;
  }

  .history-domain {
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-count {
    font-size: 11px;
    color: var(--amber);
    font-weight: 700;
    flex-shrink: 0;
  }

  .history-card-location {
    font-size: 12px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-card-date {
    font-size: 11px;
    color: var(--text-dim);
  }
`;
