/**
 * ResultRenderer — standalone result display component.
 *
 * Validates the raw API response with Zod, then delegates all viz rendering
 * to VizRenderer via VizSpec. Import this if you want a self-contained result
 * card outside of App.tsx (e.g. in a separate route or embedded widget).
 */
import { z } from "zod";
import { buildVizSpec } from "../types";
import { VizRenderer } from "./VizRenderer";

// ── Zod schema ────────────────────────────────────────────────────────────────

const VizHintSchema = z.enum(["map", "bar", "table", "dashboard"]);

const ExecuteResultSchema = z.object({
  query_id: z.string(),
  plan: z.object({
    category: z.string(),
    date_from: z.string(),
    date_to: z.string(),
    location: z.string(),
  }),
  ephemeral: z.boolean().optional().default(false),
  viz_hint: VizHintSchema,
  resolved_location: z.string(),
  count: z.number(),
  months_fetched: z.array(z.string()),
  results: z.array(z.record(z.string(), z.unknown())),
  cache_hit: z.boolean(),
  aggregated: z.boolean().optional().default(false),
  resultContext: z
    .object({
      status: z.enum(["exact", "fallback", "empty"]),
      reason: z.string().optional(),
      followUps: z.array(z.object({ label: z.string(), query: z.any() })),
      confidence: z.enum(["high", "medium", "low"]),
    })
    .optional(),
  insight: z.string().nullable().optional(),
});

type ValidatedResult = z.infer<typeof ExecuteResultSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCategory(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatMonth(ym: string): string {
  const [year, month] = ym.split("-");
  return new Date(parseInt(year), parseInt(month) - 1).toLocaleString("en-GB", {
    month: "short",
    year: "numeric",
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryLine({ data }: { data: ValidatedResult }) {
  const { count, plan, viz_hint, resolved_location, months_fetched, aggregated, cache_hit, ephemeral } = data;
  const dateRange =
    plan.date_from === plan.date_to
      ? formatMonth(plan.date_from)
      : `${formatMonth(plan.date_from)} – ${formatMonth(plan.date_to)}`;

  if (viz_hint === "dashboard") {
    return (
      <div className="summary-line">
        <span className="summary-desc">
          <strong>{resolved_location}</strong> · {dateRange}
          {months_fetched.length > 1 && ` · ${months_fetched.length} months`}
        </span>
        <div className="summary-badges">
          {ephemeral && <span className="badge badge-green">Live · not saved</span>}
          {cache_hit && <span className="badge badge-amber">cached</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="summary-line">
      <span className="summary-count">{count}</span>
      <span className="summary-desc">
        {formatCategory(plan.category).toLowerCase()} in{" "}
        <strong>{resolved_location}</strong> · {dateRange}
        {months_fetched.length > 1 && ` · ${months_fetched.length} months`}
      </span>
      <div className="summary-badges">
        {aggregated && <span className="badge badge-blue">aggregated</span>}
        {ephemeral && <span className="badge badge-green">Live · not saved</span>}
        {cache_hit && <span className="badge badge-amber">cached</span>}
      </div>
    </div>
  );
}

// ── ResultRenderer ────────────────────────────────────────────────────────────

interface Props {
  result: unknown;
  onRefine?: () => void;
  onFollowUp?: (query: unknown) => void;
}

export function ResultRenderer({ result, onRefine, onFollowUp }: Props) {
  const parsed = ExecuteResultSchema.safeParse(result);

  if (!parsed.success) {
    return (
      <div className="zod-error">
        <div className="zod-error-label">Unexpected response shape</div>
        <pre className="zod-error-detail">
          {parsed.error.issues
            .map((i) => `${i.path.join(".")} — ${i.message}`)
            .join("\n")}
        </pre>
      </div>
    );
  }

  const data = parsed.data;
  const { query_id, viz_hint, count, months_fetched, results, aggregated, resultContext, insight } = data;
  const safeContext = resultContext ?? { status: "exact" as const, followUps: [], confidence: "high" as const };
  const followUps = safeContext.followUps ?? [];

  return (
    <div className="result-panel">
      <SummaryLine data={data} />

      {safeContext.status === "fallback" && safeContext.reason && (
        <div className="fallback-banner">
          <span className="fallback-icon">⚠</span>
          <span className="fallback-text">{safeContext.reason}</span>
        </div>
      )}

      {insight && <p className="result-insight">{insight}</p>}

      {count === 0 ? (
        <div className="empty-panel">
          <div className="empty-icon">○</div>
          <div className="empty-title">No results found</div>
          <p className="empty-message">
            No results for <strong>{formatCategory(data.plan.category)}</strong>.
          </p>
          {safeContext.reason && <p className="empty-reason">{safeContext.reason}</p>}
        </div>
      ) : (
        <VizRenderer
          spec={buildVizSpec(viz_hint, results, {
            aggregated,
            months: months_fetched,
          })}
        />
      )}

      {count > 0 && viz_hint !== "dashboard" && !data.ephemeral && (
        <div className="download-toolbar">
          <a
            href={`/api/query/${query_id}/export?format=csv`}
            download="dredge-export.csv"
            className="btn-ghost small"
          >
            Download CSV
          </a>
          <a
            href={`/api/query/${query_id}/export?format=geojson`}
            download="dredge-export.geojson"
            className="btn-ghost small"
          >
            Download GeoJSON
          </a>
        </div>
      )}

      {count > 0 && followUps.length > 0 && (
        <div className="followup-chips">
          {followUps.slice(0, 4).map((f) => (
            <button
              key={f.label}
              className="followup-chip"
              onClick={() => onFollowUp?.(f.query)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {onRefine && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn-ghost small" onClick={onRefine}>
            New query
          </button>
        </div>
      )}
    </div>
  );
}
