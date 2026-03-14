import { useMemo, useState } from "react";
import { z } from "zod";

// ── Schemas ────────────────────────────────────────────────────────────────────

const AggregatedBinSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  count: z.number(),
});

const CrimeResultSchema = z.object({
  id: z.string().optional(),
  category: z.string(),
  street: z.string().optional(),
  month: z.string(),
  outcome_category: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

const VizHintSchema = z.enum(["map", "bar", "table", "dashboard"]);

const FallbackInfoSchema = z.object({
  field: z.enum(["date", "location", "category", "radius"]),
  original: z.string(),
  used: z.string(),
  explanation: z.string(),
});

const FollowUpSchema = z.object({
  label: z.string(),
  query: z.any(),
});

const ResultContextSchema = z.object({
  status: z.enum(["exact", "fallback", "empty"]),
  reason: z.string().optional(),
  fallback: FallbackInfoSchema.optional(),
  followUps: z.array(FollowUpSchema),
  confidence: z.enum(["high", "medium", "low"]),
});

const ExecuteResultSchema = z.object({
  query_id: z.string(),
  plan: z.object({
    category: z.string(),
    date_from: z.string(),
    date_to: z.string(),
    location: z.string(),
  }),
  poly: z.string(),
  viz_hint: VizHintSchema,
  resolved_location: z.string(),
  count: z.number(),
  months_fetched: z.array(z.string()),
  results: z.union([z.array(AggregatedBinSchema), z.array(CrimeResultSchema)]),
  cache_hit: z.boolean(),
  resultContext: ResultContextSchema.optional(),
  aggregated: z.boolean(),
});

// ── Types ──────────────────────────────────────────────────────────────────────

type AggregatedBin = z.infer<typeof AggregatedBinSchema>;
type CrimeResult = z.infer<typeof CrimeResultSchema>;
type ExecuteResult = z.infer<typeof ExecuteResultSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const API = "http://localhost:3001";

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

function isAggregatedBins(
  results: AggregatedBin[] | CrimeResult[],
): results is AggregatedBin[] {
  return (
    results.length > 0 &&
    "lon" in results[0] &&
    "count" in results[0] &&
    !("category" in results[0])
  );
}

// ── DownloadToolbar ───────────────────────────────────────────────────────────

function DownloadToolbar({ queryId }: { queryId: string }) {
  function triggerDownload(format: "csv" | "geojson") {
    const url = `${API}/query/${encodeURIComponent(queryId)}/export?format=${format}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `dredge-${queryId}.${format === "geojson" ? "geojson" : "csv"}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div className="download-toolbar">
      <button
        className="download-btn"
        onClick={() => triggerDownload("csv")}
        title="Download all results as CSV"
      >
        ↓ Download CSV
      </button>
      <button
        className="download-btn"
        onClick={() => triggerDownload("geojson")}
        title="Download all results as GeoJSON"
      >
        ↓ Download GeoJSON
      </button>
    </div>
  );
}

// ── AggregatedMapView ─────────────────────────────────────────────────────────
// Renders pre-aggregated bins from the server as a heatmap using deck.gl.
// Imported lazily to avoid breaking non-map paths if the map bundle is absent.
// Falls back to a static count badge if deck.gl is unavailable.

function AggregatedMapView({ bins }: { bins: AggregatedBin[] }) {
  // Dynamic import of map dependencies so the module compiles cleanly
  // even in envs where deck.gl or maplibre aren't installed.
  const [MapComponents, setMapComponents] = useState<any>(null);
  const [mapError, setMapError] = useState(false);

  useMemo(() => {
    Promise.all([
      import("react-map-gl/maplibre"),
      import("maplibre-gl"),
      import("@deck.gl/mapbox"),
      import("@deck.gl/aggregation-layers"),
    ])
      .then(([mapgl, maplibregl, deckMapbox, aggLayers]) => {
        setMapComponents({
          Map: mapgl.default,
          maplibregl: maplibregl.default,
          MapboxOverlay: deckMapbox.MapboxOverlay,
          useControl: mapgl.useControl,
          HeatmapLayer: aggLayers.HeatmapLayer,
        });
      })
      .catch(() => setMapError(true));
  }, []);

  const first = bins[0];
  const maxCount = Math.max(...bins.map((b) => b.count), 1);

  // Fallback while map loads or if deps are missing
  if (mapError || !MapComponents) {
    return (
      <div className="agg-fallback">
        <div className="agg-fallback-grid">
          {bins.slice(0, 100).map((bin, i) => (
            <div
              key={i}
              className="agg-cell"
              style={{ opacity: 0.2 + (bin.count / maxCount) * 0.8 }}
              title={`${bin.count} incidents at ${bin.lat.toFixed(4)}, ${bin.lon.toFixed(4)}`}
            />
          ))}
        </div>
        <p className="agg-fallback-note">
          {bins.length} aggregated cells · map unavailable
        </p>
      </div>
    );
  }

  const { Map, maplibregl, MapboxOverlay, useControl, HeatmapLayer } =
    MapComponents;

  function DeckOverlay(props: any) {
    const overlay = useControl(() => new MapboxOverlay(props));
    overlay.setProps(props);
    return null;
  }

  const heatLayer = new HeatmapLayer({
    id: "agg-heat",
    data: bins,
    getPosition: (d: AggregatedBin) => [d.lon, d.lat],
    getWeight: (d: AggregatedBin) => d.count,
    radiusPixels: 60,
  });

  return (
    <div className="map-container">
      <div className="map-agg-badge">aggregated · {bins.length} cells</div>
      <Map
        mapLib={maplibregl}
        initialViewState={{
          longitude: first?.lon ?? -0.1276,
          latitude: first?.lat ?? 51.5074,
          zoom: 11,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="https://tiles.openfreemap.org/styles/liberty"
      >
        <DeckOverlay layers={[heatLayer]} />
      </Map>
    </div>
  );
}

// ── SummaryLine ───────────────────────────────────────────────────────────────

function SummaryLine({ result }: { result: ExecuteResult }) {
  const {
    count,
    plan,
    resolved_location,
    months_fetched,
    aggregated,
    cache_hit,
  } = result;

  const dateRange =
    plan.date_from === plan.date_to
      ? formatMonth(plan.date_from)
      : `${formatMonth(plan.date_from)} – ${formatMonth(plan.date_to)}`;

  return (
    <div className="summary-line">
      <span className="summary-count">{count}</span>
      <span className="summary-desc">
        {formatCategory(plan.category).toLowerCase()} in{" "}
        <strong>{resolved_location}</strong>
        {" · "}
        {dateRange}
        {months_fetched.length > 1 && ` · ${months_fetched.length} months`}
      </span>
      <div className="summary-badges">
        {aggregated && <span className="badge badge-blue">aggregated</span>}
        {cache_hit && <span className="badge badge-amber">cached</span>}
      </div>
    </div>
  );
}

// ── BarChart ──────────────────────────────────────────────────────────────────

function BarChart({
  results,
  months_fetched,
}: {
  results: CrimeResult[];
  months_fetched: string[];
}) {
  const counts: Record<string, number> = {};
  for (const m of months_fetched) counts[m] = 0;
  for (const r of results) {
    if (r.month in counts) counts[r.month]++;
  }
  const max = Math.max(...Object.values(counts), 1);

  return (
    <div className="bar-chart">
      {months_fetched.map((month) => {
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

// ── TableView ─────────────────────────────────────────────────────────────────

function TableView({ results }: { results: CrimeResult[] }) {
  const capped = results.slice(0, 50);
  return (
    <div className="table-wrapper">
      <table className="result-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Street</th>
            <th>Month</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {capped.map((r, i) => (
            <tr key={r.id ?? i}>
              <td>{formatCategory(r.category)}</td>
              <td>{r.street ?? "—"}</td>
              <td>{r.month}</td>
              <td>{r.outcome_category ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {results.length > 50 && (
        <div className="table-cap-note">
          Showing 50 of {results.length} results — download CSV for full data
        </div>
      )}
    </div>
  );
}

// ── ResultRenderer ────────────────────────────────────────────────────────────

interface Props {
  result: unknown; // validated at this boundary
  onRefine?: () => void;
  onFollowUp?: (query: unknown) => void;
}

export function ResultRenderer({ result, onRefine, onFollowUp }: Props) {
  // ── Zod validation ──
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
  const {
    query_id,
    plan,
    viz_hint,
    count,
    months_fetched,
    results,
    aggregated,
    resultContext,
  } = data;

  const safeContext = resultContext ?? {
    status: "exact" as const,
    followUps: [],
    confidence: "high" as const,
  };

  const followUps = safeContext.followUps ?? [];
  const isDashboard = viz_hint === "dashboard";

  // ── Visualisation selection ──

  function renderViz() {
    if (count === 0) {
      return (
        <div className="empty-panel">
          <div className="empty-icon">○</div>
          <div className="empty-title">No results found</div>
          <p className="empty-message">
            No {formatCategory(plan.category).toLowerCase()} were recorded in
            this area for{" "}
            {plan.date_from === plan.date_to
              ? formatMonth(plan.date_from)
              : `${formatMonth(plan.date_from)} – ${formatMonth(plan.date_to)}`}
            .
          </p>
          {safeContext.reason && (
            <p className="empty-reason">{safeContext.reason}</p>
          )}
        </div>
      );
    }

    if (viz_hint === "map") {
      if (aggregated && isAggregatedBins(results)) {
        // Server pre-aggregated — render heatmap from bins using count as weight
        return <AggregatedMapView bins={results} />;
      }
      // Raw points — existing MapView path (rendered from parent via prop-pass
      // or inline below with the full MapView implementation from App.tsx)
      const crimeResults = results as CrimeResult[];
      return <LegacyMapView results={crimeResults} />;
    }

    if (viz_hint === "bar") {
      return (
        <BarChart
          results={results as CrimeResult[]}
          months_fetched={months_fetched}
        />
      );
    }

    // "table" (and any unrecognised hint)
    return <TableView results={results as CrimeResult[]} />;
  }

  return (
    <div className="result-panel">
      {/* Summary line */}
      <SummaryLine result={data} />

      {/* Fallback banner */}
      {safeContext.fallback && (
        <div className="fallback-banner">
          <span className="fallback-icon">⚠</span>
          <span className="fallback-text">
            {safeContext.fallback.explanation}
          </span>
        </div>
      )}

      {/* Visualisation */}
      {renderViz()}

      {/* Download toolbar — only for non-empty, non-dashboard results */}
      {count > 0 && !isDashboard && <DownloadToolbar queryId={query_id} />}

      {/* Follow-up chips */}
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

      {/* Refine */}
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

// ── LegacyMapView (inline, no additional deps) ────────────────────────────────
// Mirrors the MapView in App.tsx so ResultRenderer is self-contained.
// If your build already imports MapView from App.tsx you can delete this and
// replace the reference above with your shared component.

import Map from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { useControl } from "react-map-gl/maplibre";
import { ScatterplotLayer } from "@deck.gl/layers";
import { HexagonLayer, HeatmapLayer } from "@deck.gl/aggregation-layers";
import "maplibre-gl/dist/maplibre-gl.css";

type MapMode = "points" | "clusters" | "heatmap";

function DeckGLOverlay(props: any) {
  const overlay = useControl(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

function LegacyMapView({ results }: { results: CrimeResult[] }) {
  const [mode, setMode] = useState<MapMode>("points");
  const [hover, setHover] = useState<CrimeResult | null>(null);

  const points = useMemo(
    () =>
      results
        .map((c) => ({ ...c, lng: c.longitude, lat: c.latitude }))
        .filter(
          (c) =>
            c.lng != null &&
            c.lat != null &&
            Number.isFinite(c.lng) &&
            Number.isFinite(c.lat),
        ),
    [results],
  );

  const first = points[0];

  const layers = useMemo(() => {
    if (mode === "points")
      return [
        new ScatterplotLayer({
          id: "crime-points",
          data: points,
          getPosition: (d: any) => [d.lng, d.lat],
          getRadius: 30,
          radiusUnits: "meters",
          getFillColor: [245, 166, 35, 200],
          pickable: true,
          onHover: (info: any) => setHover(info.object ?? null),
        }),
      ];
    if (mode === "clusters")
      return [
        new HexagonLayer({
          id: "crime-clusters",
          data: points,
          getPosition: (d: any) => [d.lng, d.lat],
          radius: 200,
          elevationScale: 30,
          extruded: true,
          pickable: true,
        }),
      ];
    if (mode === "heatmap")
      return [
        new HeatmapLayer({
          id: "crime-heat",
          data: points,
          getPosition: (d: any) => [d.lng, d.lat],
          radiusPixels: 60,
        }),
      ];
    return [];
  }, [points, mode]);

  return (
    <div className="map-container">
      <div className="map-mode-bar">
        {(["points", "clusters", "heatmap"] as MapMode[]).map((m) => (
          <button
            key={m}
            className={`map-mode-btn ${mode === m ? "active" : ""}`}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>
      <Map
        mapLib={maplibregl}
        initialViewState={{
          longitude: first?.lng ?? -0.1276,
          latitude: first?.lat ?? 51.5074,
          zoom: 12,
          pitch: 40,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="https://tiles.openfreemap.org/styles/liberty"
      >
        <DeckGLOverlay layers={layers} />
      </Map>
      {hover && (
        <div className="map-tooltip">
          <strong>{formatCategory(hover.category)}</strong>
          <span>{hover.street ?? "—"}</span>
          <span>{hover.month}</span>
          {hover.outcome_category && <em>{hover.outcome_category}</em>}
        </div>
      )}
    </div>
  );
}

// ── CSS ───────────────────────────────────────────────────────────────────────
// Inject styles for the new elements added in Step 7. The existing styles from
// App.tsx cover .result-panel, .map-container, .bar-chart, etc. — these rules
// only cover the new pieces: download toolbar, summary line, badges, zod error.

const styles = `
  /* ── Summary line ── */
  .summary-line {
    display: flex;
    align-items: baseline;
    gap: 10px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 14px;
    flex-wrap: wrap;
  }
  .summary-count {
    font-family: var(--display);
    font-size: 40px;
    font-weight: 800;
    color: var(--amber);
    line-height: 1;
    flex-shrink: 0;
  }
  .summary-desc {
    color: var(--text-mid);
    font-size: 12px;
    flex: 1;
  }
  .summary-badges {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-left: auto;
  }

  /* ── Badges ── */
  .badge {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    padding: 2px 7px;
    border-radius: 2px;
    border: 1px solid;
    text-transform: uppercase;
  }
  .badge-amber { color: var(--amber); border-color: var(--amber-dim); background: rgba(245,166,35,0.08); }
  .badge-blue  { color: #60a5fa;     border-color: rgba(96,165,250,0.3); background: rgba(96,165,250,0.06); }

  /* ── Download toolbar ── */
  .download-toolbar {
    display: flex;
    gap: 8px;
    padding-top: 4px;
  }
  .download-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.04em;
    padding: 6px 14px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }
  .download-btn:hover { color: var(--text); border-color: var(--text-mid); }

  /* ── Aggregated map badge ── */
  .map-agg-badge {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 10;
    background: var(--bg);
    border: 1px solid var(--border);
    color: #60a5fa;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.04em;
    padding: 4px 10px;
  }

  /* ── Aggregated fallback (no map) ── */
  .agg-fallback {
    border: 1px solid var(--border);
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    background: var(--bg2);
  }
  .agg-fallback-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    max-width: 400px;
    justify-content: center;
  }
  .agg-cell {
    width: 12px;
    height: 12px;
    background: var(--amber);
    border-radius: 1px;
  }
  .agg-fallback-note { font-size: 11px; color: var(--text-dim); }

  /* ── Zod validation error ── */
  .zod-error {
    border: 1px solid var(--red);
    background: #110a0a;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    animation: fadeIn 0.2s ease;
  }
  .zod-error-label {
    font-size: 10px;
    letter-spacing: 0.12em;
    color: var(--red);
    text-transform: uppercase;
  }
  .zod-error-detail {
    font-family: var(--mono);
    font-size: 11px;
    color: #f87171;
    white-space: pre-wrap;
    margin: 0;
    line-height: 1.7;
  }
`;

// Inject styles once on module load
if (typeof document !== "undefined") {
  const id = "result-renderer-styles";
  if (!document.getElementById(id)) {
    const el = document.createElement("style");
    el.id = id;
    el.textContent = styles;
    document.head.appendChild(el);
  }
}
