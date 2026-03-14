import { useState, useRef, useEffect, useMemo } from "react";
import Map from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { useControl } from "react-map-gl/maplibre";
import { ScatterplotLayer } from "@deck.gl/layers";
import { HexagonLayer, HeatmapLayer } from "@deck.gl/aggregation-layers";
import "maplibre-gl/dist/maplibre-gl.css";

// ── Types ─────────────────────────────────────────────────────────────────────

type VizHint = "map" | "bar" | "table";

interface QueryPlan {
  category: string;
  date_from: string;
  date_to: string;
  location: string;
}

interface ParsedQuery {
  plan: QueryPlan;
  poly: string;
  viz_hint: VizHint;
  resolved_location: string;
  country_code: string;
  intent: string;
  months: string[];
}

interface CrimeResult {
  id?: string;
  category: string;
  street?: string;
  month: string;
  outcome_category?: string;
  latitude?: number;
  longitude?: number;
  [key: string]: unknown;
}

// v5.1 types
interface ExecuteBody {
  plan: QueryPlan;
  poly: string;
  viz_hint: VizHint;
  resolved_location: string;
  country_code: string;
  intent: string;
  months: string[];
}

interface FallbackInfo {
  field: "date" | "location" | "category" | "radius";
  original: string;
  used: string;
  explanation: string;
}

interface FollowUp {
  label: string;
  query: ExecuteBody;
}

interface ResultContext {
  status: "exact" | "fallback" | "empty";
  reason?: string;
  fallback?: FallbackInfo;
  followUps: FollowUp[];
  confidence: "high" | "medium" | "low";
}

interface ExecuteResult {
  query_id: string;
  plan: QueryPlan;
  poly: string;
  viz_hint: VizHint;
  resolved_location: string;
  count: number;
  months_fetched: string[];
  results: CrimeResult[] | AggregatedBin[];
  cache_hit: boolean;
  resultContext?: ResultContext;
  aggregated: boolean;
}

interface IntentError {
  error: string;
  understood: Partial<QueryPlan>;
  missing: string[];
  message: string;
}

interface AggregatedBin {
  lat: number;
  lon: number;
  count: number;
}

type Stage = "idle" | "loading" | "done" | "error";

// ── Helpers ───────────────────────────────────────────────────────────────────

const API = "http://localhost:3001";

const EXAMPLES = [
  "burglaries in Cambridge in January 2024",
  "drug offences in Camden last 3 months",
  "list violent crime in Bristol last month",
];

function formatMonth(ym: string): string {
  const [year, month] = ym.split("-");
  return new Date(parseInt(year), parseInt(month) - 1).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

function formatCategory(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── QueryInput ────────────────────────────────────────────────────────────────

function QueryInput({
  onSubmit,
  loading,
  initialText = "",
  loadingStage,
}: {
  onSubmit: (text: string) => void;
  loading: boolean;
  initialText?: string;
  loadingStage: "interpreting" | "fetching" | null;
}) {
  const [text, setText] = useState(initialText);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialText) {
      setText(initialText);
      inputRef.current?.focus();
    }
  }, [initialText]);

  const handleSubmit = () => {
    if (text.trim() && !loading) onSubmit(text.trim());
  };

  const btnLabel =
    loadingStage === "interpreting"
      ? "Interpreting..."
      : loadingStage === "fetching"
        ? "Fetching data..."
        : "Search";

  return (
    <div className="query-input-wrapper">
      <div className="query-input-row">
        <span className="prompt-symbol">›</span>
        <input
          ref={inputRef}
          className="query-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="e.g. burglaries in Cambridge last 3 months"
          disabled={loading}
          autoFocus
        />
        <button
          className="query-btn"
          onClick={handleSubmit}
          disabled={loading || !text.trim()}
        >
          {btnLabel}
        </button>
      </div>
      {loading && (
        <div className="loading-bar">
          <div
            className={`loading-bar-inner ${loadingStage === "fetching" ? "slow" : ""}`}
          />
        </div>
      )}
      {!loading && !text && (
        <div className="examples-row">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              className="example-chip"
              onClick={() => {
                setText(ex);
                inputRef.current?.focus();
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── InterpretationBanner ──────────────────────────────────────────────────────

function InterpretationBanner({
  parsed,
  onRefine,
  cacheHit,
}: {
  parsed: ParsedQuery;
  onRefine: () => void;
  cacheHit: boolean;
}) {
  const { plan, viz_hint, resolved_location, months } = parsed;
  const singleMonth = plan.date_from === plan.date_to;
  const vizLabel: Record<VizHint, string> = {
    map: "map",
    bar: "bar chart",
    table: "table",
  };

  return (
    <div className="interpretation-banner">
      <div className="interpretation-text">
        <span className="interp-label">Searched for </span>
        <strong>{formatCategory(plan.category)}</strong>
        {" in "}
        <strong>{resolved_location}</strong>
        {" · "}
        {singleMonth ? (
          <strong>{formatMonth(plan.date_from)}</strong>
        ) : (
          <>
            <strong>{formatMonth(plan.date_from)}</strong>
            {" – "}
            <strong>{formatMonth(plan.date_to)}</strong>
            {` · ${months.length} months`}
          </>
        )}
        {" · "}
        <span className="interp-viz">{vizLabel[viz_hint]}</span>
        {cacheHit && (
          <span
            style={{
              marginLeft: 8,
              fontSize: "0.75rem",
              color: "#f5a623",
              border: "1px solid #f5a623",
              borderRadius: 3,
              padding: "1px 5px",
            }}
          >
            cached
          </span>
        )}
      </div>
      <button className="btn-ghost small" onClick={onRefine}>
        Refine ↩
      </button>
    </div>
  );
}

// ── FallbackBanner ────────────────────────────────────────────────────────────

export function FallbackBanner({ fallback }: { fallback?: FallbackInfo }) {
  if (!fallback) return null;
  return (
    <div className="fallback-banner">
      <span className="fallback-icon">⚠</span>
      <span className="fallback-text">{fallback.explanation}</span>
    </div>
  );
}

// ── FollowUpChips ─────────────────────────────────────────────────────────────

export function FollowUpChips({
  followUps,
  onSelect,
}: {
  followUps: FollowUp[];
  onSelect: (query: ExecuteBody) => void;
}) {
  if (followUps.length === 0) return null;
  const capped = followUps.slice(0, 4);
  return (
    <div className="followup-chips">
      {capped.map((f) => (
        <button
          key={f.label}
          className="followup-chip"
          onClick={() => onSelect(f.query)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

// ── IntentError ───────────────────────────────────────────────────────────────

function IntentErrorPanel({
  error,
  onRetry,
}: {
  error: IntentError;
  onRetry: () => void;
}) {
  const understoodEntries = Object.entries(error.understood ?? {}).filter(
    ([, v]) => v,
  );
  const isServiceError =
    error.error === "network_error" || error.error === "execute_error";

  return (
    <div className="error-panel">
      <div className="error-label">
        {isServiceError ? "SERVICE ERROR" : "COULD NOT INTERPRET QUERY"}
      </div>
      <p className="error-message">{error.message}</p>
      {!isServiceError && (
        <>
          <div className="chip-row">
            {understoodEntries.map(([key, value]) => (
              <span key={key} className="chip chip-green">
                ✓ {key}: {String(value)}
              </span>
            ))}
            {(error.missing ?? []).map((field) => (
              <span key={field} className="chip chip-amber">
                ? missing: {field}
              </span>
            ))}
          </div>
          {understoodEntries.length === 0 && (
            <p className="error-hint">
              Try including a location, crime type, and time period —{" "}
              <em>"burglaries in Manchester last month"</em>
            </p>
          )}
        </>
      )}
      <button className="btn-ghost retry-btn" onClick={onRetry}>
        ← Try again
      </button>
    </div>
  );
}

// ── EmptyResults ──────────────────────────────────────────────────────────────

export function EmptyResults({
  plan,
  onRefine,
  resultContext,
  onFollowUp,
}: {
  plan: QueryPlan;
  onRefine: () => void;
  resultContext: ResultContext;
  onFollowUp: (query: ExecuteBody) => void;
}) {
  return (
    <div className="empty-panel">
      <div className="empty-icon">○</div>
      <div className="empty-title">No results found</div>
      <p className="empty-message">
        No {formatCategory(plan.category).toLowerCase()} were recorded in this
        area for{" "}
        {plan.date_from === plan.date_to
          ? formatMonth(plan.date_from)
          : `${formatMonth(plan.date_from)} – ${formatMonth(plan.date_to)}`}
        .
      </p>
      {resultContext.reason && (
        <p className="empty-reason">{resultContext.reason}</p>
      )}
      <p className="empty-hint">
        Police data typically lags by 2–3 months. Try an earlier date range.
      </p>
      <FollowUpChips
        followUps={resultContext.followUps}
        onSelect={onFollowUp}
      />
      <button className="btn-ghost" onClick={onRefine}>
        Refine query
      </button>
    </div>
  );
}

// ── DeckGL Overlay ────────────────────────────────────────────────────────────

function DeckGLOverlay(props: any) {
  const overlay = useControl(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

// ── MapView ───────────────────────────────────────────────────────────────────

type MapMode = "points" | "clusters" | "heatmap";

function MapView({
  results,
  aggregated,
}: {
  results: CrimeResult[] | AggregatedBin[];
  aggregated: boolean;
}) {
  const [mode, setMode] = useState<MapMode>("points");
  const [hover, setHover] = useState<CrimeResult | null>(null);

  const points = useMemo(
    () =>
      aggregated
        ? (results as AggregatedBin[]).map((b) => ({
            lng: b.lon,
            lat: b.lat,
            count: b.count,
          }))
        : (results as CrimeResult[])
            .map((c) => ({ ...c, lng: c.longitude, lat: c.latitude }))
            .filter(
              (c) =>
                c.lng != null &&
                c.lat != null &&
                Number.isFinite(c.lng) &&
                Number.isFinite(c.lat),
            ),
    [results, aggregated],
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
            <tr key={i}>
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
          Showing 50 of {results.length} results
        </div>
      )}
    </div>
  );
}

// ── ResultRenderer ────────────────────────────────────────────────────────────

function ResultRenderer({
  result,
  onRefine,
  onFollowUp,
}: {
  result: ExecuteResult;
  onRefine: () => void;
  onFollowUp: (query: ExecuteBody) => void;
}) {
  const { plan, viz_hint, count, months_fetched, results, resultContext } =
    result;

  const safeContext: ResultContext = resultContext ?? {
    status: "exact",
    followUps: [],
    confidence: "high",
  };

  const followUps = safeContext.followUps ?? [];

  return (
    <div className="result-panel">
      <div className="result-header">
        <div className="result-summary">
          <span className="result-count">{count}</span>
          <span className="result-desc">
            {formatCategory(plan.category).toLowerCase()} incidents
          </span>
        </div>
        <button className="btn-ghost small" onClick={onRefine}>
          New query
        </button>
      </div>

      {safeContext.fallback && (
        <FallbackBanner fallback={safeContext.fallback} />
      )}

      {count === 0 ? (
        <EmptyResults
          plan={plan}
          onRefine={onRefine}
          resultContext={safeContext}
          onFollowUp={onFollowUp}
        />
      ) : viz_hint === "map" ? (
        <MapView results={results} aggregated={result.aggregated} />
      ) : viz_hint === "bar" ? (
        <BarChart
          results={results as CrimeResult[]}
          months_fetched={months_fetched}
        />
      ) : (
        <TableView results={results as CrimeResult[]} />
      )}

      {count > 0 && viz_hint !== "dashboard" && (
        <div className="download-toolbar">
          <a
            href={`${API}/query/${result.query_id}/export?format=csv`}
            download="dredge-export.csv"
            className="btn-ghost small"
          >
            Download CSV
          </a>
          <a
            href={`${API}/query/${result.query_id}/export?format=geojson`}
            download="dredge-export.geojson"
            className="btn-ghost small"
          >
            Download GeoJSON
          </a>
        </div>
      )}

      {count > 0 && followUps.length > 0 && (
        <FollowUpChips followUps={followUps} onSelect={onFollowUp} />
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [stage, setStage] = useState<Stage>("idle");
  const [loadingStage, setLoadingStage] = useState<
    "interpreting" | "fetching" | null
  >(null);
  const [parsed, setParsed] = useState<ParsedQuery | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);
  const [intentError, setIntentError] = useState<IntentError | null>(null);
  const [refineText, setRefineText] = useState("");

  const handleQuery = async (text: string) => {
    setStage("loading");
    setLoadingStage("interpreting");
    setIntentError(null);
    setParsed(null);
    setResult(null);

    // Step 1 — parse
    let parseData: ParsedQuery;
    try {
      const res = await fetch(`${API}/query/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIntentError(data);
        setStage("error");
        setLoadingStage(null);
        setRefineText(text);
        return;
      }
      parseData = data;
    } catch {
      setIntentError({
        error: "network_error",
        understood: {},
        missing: [],
        message:
          "Could not reach the server. Is the orchestrator running on port 3001?",
      });
      setStage("error");
      setLoadingStage(null);
      return;
    }

    // Step 2 — execute
    setLoadingStage("fetching");
    try {
      const res = await fetch(`${API}/query/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parseData),
      });
      const data = await res.json();
      if (!res.ok) {
        setIntentError({
          error: "execute_error",
          understood: {},
          missing: [],
          message:
            data.message ?? "Execution failed. Check the orchestrator logs.",
        });
        setStage("error");
        setLoadingStage(null);
        setRefineText(text);
        return;
      }
      setParsed(parseData);
      setResult(data);
      setRefineText(text);
      setStage("done");
    } catch {
      setIntentError({
        error: "network_error",
        understood: {},
        missing: [],
        message: "Lost connection during data fetch.",
      });
      setStage("error");
    }
    setLoadingStage(null);
  };

  // Follow-up chips call /execute directly — no /parse round-trip
  const handleFollowUp = async (query: ExecuteBody) => {
    setStage("loading");
    setLoadingStage("fetching");
    setResult(null);

    try {
      const res = await fetch(`${API}/query/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      });
      const data = await res.json();
      if (!res.ok) {
        setIntentError({
          error: "execute_error",
          understood: {},
          missing: [],
          message: data.message ?? "Execution failed.",
        });
        setStage("error");
        setLoadingStage(null);
        return;
      }
      setParsed(query);
      setResult(data);
      setStage("done");
    } catch (err: any) {
      setIntentError({
        error: "network_error",
        understood: {},
        missing: [],
        message: err?.message ?? "Lost connection.",
      });
      setStage("error");
    }
    setLoadingStage(null);
  };

  const handleRefine = () => {
    setStage("idle");
    setResult(null);
    setParsed(null);
    setIntentError(null);
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        <header className="app-header">
          <div className="logo">DREDGE</div>
          <div className="logo-sub">crime data explorer</div>
        </header>

        <main className="app-main">
          {stage !== "done" && (
            <QueryInput
              onSubmit={handleQuery}
              loading={stage === "loading"}
              initialText={refineText}
              loadingStage={loadingStage}
            />
          )}

          {stage === "error" && intentError && (
            <IntentErrorPanel error={intentError} onRetry={handleRefine} />
          )}

          {stage === "done" && parsed && (
            <InterpretationBanner
              parsed={parsed}
              onRefine={handleRefine}
              cacheHit={result?.cache_hit ?? false}
            />
          )}

          {stage === "done" && result && (
            <ResultRenderer
              result={result}
              onRefine={handleRefine}
              onFollowUp={handleFollowUp}
            />
          )}
        </main>

        <footer className="app-footer">
          Data: data.police.uk · Geocoding: Nominatim/OSM · Police data lags
          ~2–3 months
        </footer>
      </div>
    </>
  );
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Syne:wght@400;700;800&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0a0a0b;
    --bg2: #111114;
    --bg3: #1a1a1f;
    --border: #2a2a33;
    --amber: #f5a623;
    --amber-dim: #b87a1a;
    --green: #3ddc84;
    --green-dim: #1e6b42;
    --red: #ff4d4d;
    --text: #e8e8f0;
    --text-dim: #666680;
    --text-mid: #9999b0;
    --mono: 'JetBrains Mono', monospace;
    --display: 'Syne', sans-serif;
  }

  html, body, #root { height: 100%; background: var(--bg); color: var(--text); }

  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.6;
  }

  .app-header {
    padding: 24px 32px 20px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: baseline;
    gap: 16px;
  }

  .logo {
    font-family: var(--display);
    font-size: 22px;
    font-weight: 800;
    letter-spacing: 0.12em;
    color: var(--amber);
  }

  .logo-sub {
    font-size: 11px;
    color: var(--text-dim);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .app-main {
    flex: 1;
    max-width: 900px;
    width: 100%;
    margin: 0 auto;
    padding: 40px 32px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .app-footer {
    padding: 16px 32px;
    border-top: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 11px;
    text-align: center;
    letter-spacing: 0.04em;
  }

  /* ── Query Input ── */

  .query-input-wrapper {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    background: var(--bg2);
  }

  .query-input-row {
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 12px;
  }

  .prompt-symbol {
    color: var(--amber);
    font-size: 18px;
    line-height: 1;
    flex-shrink: 0;
  }

  .query-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font-family: var(--mono);
    font-size: 14px;
    padding: 16px 0;
    caret-color: var(--amber);
  }

  .query-input::placeholder { color: var(--text-dim); }
  .query-input:disabled { opacity: 0.5; }

  .query-btn {
    background: var(--amber);
    color: #000;
    border: none;
    padding: 6px 18px;
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    cursor: pointer;
    text-transform: uppercase;
    flex-shrink: 0;
    transition: opacity 0.15s;
    min-width: 136px;
    text-align: center;
  }

  .query-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .query-btn:not(:disabled):hover { opacity: 0.85; }

  .loading-bar { height: 2px; background: var(--bg3); overflow: hidden; }

  .loading-bar-inner {
    height: 100%;
    width: 40%;
    background: var(--amber);
    animation: slide 1.1s ease-in-out infinite;
  }

  .loading-bar-inner.slow { animation-duration: 2.6s; }

  @keyframes slide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }

  .examples-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 10px 16px 12px;
    border-top: 1px solid var(--border);
  }

  .example-chip {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 11px;
    padding: 4px 10px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }

  .example-chip:hover { color: var(--amber); border-color: var(--amber-dim); }

  /* ── Interpretation Banner ── */

  .interpretation-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 16px;
    background: var(--bg2);
    border: 1px solid var(--border);
    border-left: 3px solid var(--amber);
    animation: fadeIn 0.2s ease;
  }

  .interpretation-text {
    font-size: 12px;
    color: var(--text-mid);
    line-height: 1.6;
  }

  .interpretation-text strong { color: var(--text); font-weight: 500; }
  .interp-label { color: var(--text-dim); }
  .interp-viz { color: var(--amber); font-size: 11px; letter-spacing: 0.04em; }

  /* ── Fallback Banner ── */

  .fallback-banner {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 16px;
    background: rgba(245, 166, 35, 0.06);
    border: 1px solid var(--amber-dim);
    border-left: 3px solid var(--amber);
    animation: fadeIn 0.2s ease;
  }

  .fallback-icon {
    color: var(--amber);
    font-size: 14px;
    flex-shrink: 0;
    line-height: 1.6;
  }

  .fallback-text {
    font-size: 12px;
    color: var(--text-mid);
    line-height: 1.6;
  }

  /* ── Follow-up Chips ── */

  .followup-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 4px 0;
  }

  .followup-chip {
    background: rgba(245, 166, 35, 0.08);
    border: 1px solid var(--amber-dim);
    color: var(--amber);
    font-family: var(--mono);
    font-size: 11px;
    padding: 6px 14px;
    cursor: pointer;
    letter-spacing: 0.04em;
    transition: background 0.15s, color 0.15s;
  }

  .followup-chip:hover {
    background: rgba(245, 166, 35, 0.18);
    color: var(--text);
  }

  /* ── Buttons ── */

  .btn-ghost {
    background: transparent;
    color: var(--text-mid);
    border: 1px solid var(--border);
    padding: 8px 20px;
    font-family: var(--mono);
    font-size: 12px;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
    white-space: nowrap;
  }

  .btn-ghost:hover { color: var(--text); border-color: var(--text-mid); }
  .btn-ghost.small { padding: 5px 12px; font-size: 11px; }

  /* ── Error ── */

  .error-panel {
    border: 1px solid #3d1515;
    background: #110a0a;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    animation: fadeIn 0.2s ease;
  }

  .error-label {
    font-size: 10px;
    letter-spacing: 0.12em;
    color: var(--red);
    text-transform: uppercase;
  }

  .error-message { color: var(--text-mid); font-size: 13px; }

  .error-hint { font-size: 12px; color: var(--text-dim); }
  .error-hint em { color: var(--text-mid); font-style: normal; }

  .chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { font-size: 11px; padding: 3px 10px; letter-spacing: 0.04em; }

  .chip-green {
    background: rgba(61, 220, 132, 0.08);
    color: var(--green);
    border: 1px solid var(--green-dim);
  }

  .chip-amber {
    background: rgba(245, 166, 35, 0.08);
    color: var(--amber);
    border: 1px solid var(--amber-dim);
  }

  .retry-btn { align-self: flex-start; margin-top: 4px; }

  /* ── Empty ── */

  .empty-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 48px 24px;
    border: 1px solid var(--border);
    background: var(--bg2);
    text-align: center;
  }

  .empty-icon { font-size: 32px; color: var(--text-dim); }
  .empty-title { font-family: var(--display); font-size: 18px; color: var(--text); }
  .empty-message { color: var(--text-mid); font-size: 13px; max-width: 400px; }
  .empty-reason { color: var(--text-mid); font-size: 12px; max-width: 400px; font-style: italic; }
  .empty-hint { color: var(--text-dim); font-size: 12px; max-width: 400px; }

  /* ── Result ── */

  .result-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
    animation: fadeIn 0.25s ease;
  }

  .result-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 14px;
  }

  .result-summary { display: flex; align-items: baseline; gap: 10px; }

  .result-count {
    font-family: var(--display);
    font-size: 40px;
    font-weight: 800;
    color: var(--amber);
    line-height: 1;
  }

  .result-desc { color: var(--text-mid); font-size: 12px; }

  /* ── Map ── */

  .map-container {
    position: relative;
    height: 500px;
    border: 1px solid var(--border);
    overflow: hidden;
  }

  .map-mode-bar {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 10;
    display: flex;
    gap: 2px;
    background: var(--bg);
    border: 1px solid var(--border);
    padding: 3px;
  }

  .map-mode-btn {
    background: transparent;
    border: none;
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 4px 12px;
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
  }

  .map-mode-btn:hover { color: var(--text); }
  .map-mode-btn.active { background: var(--amber); color: #000; font-weight: 700; }

  .map-tooltip {
    position: absolute;
    bottom: 20px;
    left: 20px;
    z-index: 10;
    background: var(--bg);
    border: 1px solid var(--border);
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12px;
    pointer-events: none;
  }

  .map-tooltip strong { color: var(--amber); }
  .map-tooltip span { color: var(--text-mid); }
  .map-tooltip em { color: var(--text-dim); font-style: normal; font-size: 11px; }

  /* ── Bar chart ── */

  .bar-chart {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    height: 220px;
    padding: 16px;
    border: 1px solid var(--border);
    background: var(--bg2);
    overflow-x: auto;
  }

  .bar-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    flex: 1;
    min-width: 36px;
    height: 100%;
    justify-content: flex-end;
  }

  .bar-count { font-size: 10px; color: var(--text-dim); }

  .bar-track {
    width: 100%;
    height: calc(100% - 40px);
    display: flex;
    align-items: flex-end;
    background: rgba(255,255,255,0.03);
  }

  .bar-fill {
    width: 100%;
    background: var(--amber);
    transition: height 0.5s ease;
    min-height: 2px;
  }

  .bar-label { font-size: 10px; color: var(--text-dim); white-space: nowrap; }

  /* ── Table ── */

  .table-wrapper { border: 1px solid var(--border); overflow-x: auto; }
  .result-table { width: 100%; border-collapse: collapse; font-size: 12px; }

  .result-table th {
    text-align: left;
    padding: 10px 14px;
    background: var(--bg3);
    color: var(--text-dim);
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-size: 10px;
    border-bottom: 1px solid var(--border);
  }

  .result-table td {
    padding: 9px 14px;
    color: var(--text-mid);
    border-bottom: 1px solid var(--border);
  }

  .result-table tr:last-child td { border-bottom: none; }
  .result-table tr:hover td { background: var(--bg2); color: var(--text); }

  .table-cap-note {
    padding: 10px 14px;
    font-size: 11px;
    color: var(--text-dim);
    background: var(--bg3);
    border-top: 1px solid var(--border);
  }

  /* ── Download toolbar ── */

  .download-toolbar {
    display: flex;
    gap: 8px;
  }

  .download-toolbar a.btn-ghost {
    text-decoration: none;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;
