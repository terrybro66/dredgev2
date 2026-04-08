import { useState, useRef, useEffect, useMemo } from "react";
import Map from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { useControl } from "react-map-gl/maplibre";
import { ScatterplotLayer } from "@deck.gl/layers";
import { HexagonLayer, HeatmapLayer } from "@deck.gl/aggregation-layers";
import * as d3Scale from "d3-scale";
import * as d3Shape from "d3-shape";
import * as d3Axis from "d3-axis";
import * as d3Selection from "d3-selection";
import "maplibre-gl/dist/maplibre-gl.css";
import { WorkspacesPanel } from "./components/WorkspacesPanel";
import {
  QueryHistoryCarousel,
  CAROUSEL_CSS,
} from "./components/QueryHistoryCarousel";
import { useDredgeStore } from "./store";

// ── Types ─────────────────────────────────────────────────────────────────────

type VizHint = "map" | "bar" | "table" | "dashboard";

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

// Action chips — Phase C.7
type ChipAction =
  | "filter_by"
  | "overlay_spatial"
  | "calculate_travel"
  | "compare_location"
  | "fetch_domain"
  | "show_map"
  | "show_chart"
  | "clarify";

interface ChipArgs {
  ref?: string;
  domain?: string;
  filters?: Record<string, unknown>;
  location?: string;
  field?: string;
  constraint?: string;
  value?: unknown;
}

interface Chip {
  label: string;
  action: ChipAction;
  args: ChipArgs;
  score?: number;
}

// D.1 — Clarification types
interface ClarificationField {
  field: string;
  prompt: string;
  input_type: "text" | "number" | "select" | "boolean";
  options?: string[];
  target: "active_filters" | "user_attributes";
}

interface ClarificationRequest {
  intent: string;
  questions: ClarificationField[];
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
  intent: string;
  chips?: Chip[];
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

interface WeatherRow {
  id: string;
  date: string;
  temperature_max: number | null;
  temperature_min: number | null;
  precipitation: number | null;
  wind_speed: number | null;
  description: string | null;
}

type Stage = "idle" | "loading" | "done" | "error";

// ── Helpers ───────────────────────────────────────────────────────────────────

const API = "http://localhost:3001";

// Recent queries will replace these static examples once the
// QueryHistoryCarousel component is built (feat/query-history-carousel).
// For now, keep a minimal set covering the main viz hint paths.
const EXAMPLES = [
  "burglaries in Cambridge last month",
  "weather in Edinburgh this week",
  "flood risk in Somerset",
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
      {!loading && !text && <QueryHistoryCarousel />}
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
  const dateFrom = plan.date_from.slice(0, 7);
  const dateTo = plan.date_to.slice(0, 7);
  const singleMonth = dateFrom === dateTo;
  const vizLabel: Record<VizHint, string> = {
    map: "map",
    bar: "bar chart",
    table: "table",
    dashboard: "dashboard",
  };

  return (
    <div className="interpretation-banner">
      <div className="interpretation-text">
        <span className="interp-label">Searched for </span>
        <strong>
          {parsed.intent === "weather"
            ? "Weather"
            : formatCategory(plan.category)}
        </strong>{" "}
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

// ── ActionChips — Phase C.7 ───────────────────────────────────────────────────

const ACTION_ICONS: Partial<Record<ChipAction, string>> = {
  show_map:         "◉",
  show_chart:       "▲",
  calculate_travel: "→",
  fetch_domain:     "⊕",
  filter_by:        "⊘",
  overlay_spatial:  "⊞",
  compare_location: "⇄",
  clarify:          "?",
};

export function ActionChips({
  chips,
  onAction,
}: {
  chips: Chip[];
  onAction: (chip: Chip) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="action-chips">
      {chips.map((chip) => (
        <button
          key={chip.label}
          className="action-chip"
          title={`${chip.action}${chip.args.domain ? ` → ${chip.args.domain}` : ""}`}
          onClick={() => onAction(chip)}
        >
          <span className="action-chip-icon">
            {ACTION_ICONS[chip.action] ?? "·"}
          </span>
          {chip.label}
        </button>
      ))}
    </div>
  );
}

// ── ClarificationPanel — Phase D.2 ───────────────────────────────────────────

export function ClarificationPanel({
  request,
  onSubmit,
  onDismiss,
}: {
  request: ClarificationRequest;
  onSubmit: (answers: Record<string, string>) => void;
  onDismiss: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const set = (field: string, value: string) =>
    setAnswers((prev) => ({ ...prev, [field]: value }));

  const allAnswered = request.questions.every(
    (q) => answers[q.field] !== undefined && answers[q.field] !== "",
  );

  return (
    <div className="clarification-panel">
      <div className="clarification-header">
        <span className="clarification-label">A FEW QUESTIONS FIRST</span>
        <button className="btn-ghost small" onClick={onDismiss}>✕</button>
      </div>
      <p className="clarification-intent">
        To check eligibility for <strong>{request.intent}</strong>, please answer:
      </p>
      <div className="clarification-fields">
        {request.questions.map((q) => (
          <div key={q.field} className="clarification-field">
            <label className="clarification-prompt">{q.prompt}</label>
            {q.input_type === "select" && q.options ? (
              <select
                className="clarification-select"
                value={answers[q.field] ?? ""}
                onChange={(e) => set(q.field, e.target.value)}
              >
                <option value="">— select —</option>
                {q.options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : q.input_type === "boolean" ? (
              <div className="clarification-bool">
                {["Yes", "No"].map((opt) => (
                  <button
                    key={opt}
                    className={`clarification-bool-btn${answers[q.field] === opt ? " selected" : ""}`}
                    onClick={() => set(q.field, opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : (
              <input
                className="clarification-input"
                type={q.input_type === "number" ? "number" : "text"}
                value={answers[q.field] ?? ""}
                onChange={(e) => set(q.field, e.target.value)}
                placeholder={q.input_type === "number" ? "Enter a number" : "Your answer"}
              />
            )}
          </div>
        ))}
      </div>
      <button
        className="clarification-submit"
        disabled={!allAnswered}
        onClick={() => allAnswered && onSubmit(answers)}
      >
        Continue →
      </button>
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
  const isNotSupported = error.error === "not_supported";

  return (
    <div className="error-panel">
      <div className="error-label">
        {isNotSupported
          ? "NOT SUPPORTED YET"
          : isServiceError
            ? "SERVICE ERROR"
            : "COULD NOT INTERPRET QUERY"}
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
        No results found for <strong>{formatCategory(plan.category)}</strong> in{" "}
        {plan.date_from === plan.date_to
          ? formatMonth(plan.date_from)
          : `${formatMonth(plan.date_from)} – ${formatMonth(plan.date_to)}`}
        .
      </p>
      {resultContext.reason && (
        <p className="empty-reason">{resultContext.reason}</p>
      )}
      <p className="empty-hint">
        Try adjusting the date range or rephrasing your query.
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
      {hover && !aggregated && (
        <div className="map-tooltip">
          <strong>
            {(hover as any).description ??
              formatCategory((hover as any).category ?? "") ??
              "—"}
          </strong>
          {(hover as any).street && <span>{(hover as any).street}</span>}
          {((hover as any).month || (hover as any).date) && (
            <span>{(hover as any).month ?? (hover as any).date}</span>
          )}
          {(hover as any).outcome_category && (
            <em>{(hover as any).outcome_category}</em>
          )}
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
  const dateField =
    results.length > 0 && "month" in results[0] ? "month" : "date";
  const counts: Record<string, number> = {};
  for (const m of months_fetched) counts[m] = 0;
  for (const r of results) {
    const key = (r as any)[dateField];
    if (typeof key === "string") {
      const ym = key.slice(0, 7);
      if (ym in counts) counts[ym]++;
    }
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
  const rows = capped as unknown as Record<string, unknown>[];
  const columns =
    rows.length > 0
      ? Object.keys(rows[0])
          .filter((k) => k !== "raw" && k !== "extras")
          .slice(0, 6)
      : [];
  return (
    <div className="table-wrapper">
      <table className="result-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{col.replace(/_/g, " ")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={(r.id as string) ?? i}>
              {columns.map((col) => (
                <td key={col}>{r[col] != null ? String(r[col]) : "—"}</td>
              ))}
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

// ── Metric cards ──────────────────────────────────────────────────────────────

function MetricCards({ rows }: { rows: WeatherRow[] }) {
  const validRows = rows.filter(
    (r) => r.temperature_max != null && r.temperature_min != null,
  );

  const avgTemp =
    validRows.length > 0
      ? validRows.reduce(
          (sum, r) => sum + (r.temperature_max! + r.temperature_min!) / 2,
          0,
        ) / validRows.length
      : null;

  const totalPrecip = rows.reduce((sum, r) => sum + (r.precipitation ?? 0), 0);

  const avgWind =
    rows.filter((r) => r.wind_speed != null).length > 0
      ? rows.reduce((sum, r) => sum + (r.wind_speed ?? 0), 0) /
        rows.filter((r) => r.wind_speed != null).length
      : null;

  const descCounts: Record<string, number> = {};
  rows.forEach((r) => {
    if (r.description)
      descCounts[r.description] = (descCounts[r.description] ?? 0) + 1;
  });
  const dominantDesc =
    Object.entries(descCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  const cards = [
    {
      label: "Avg Temperature",
      value: avgTemp != null ? `${avgTemp.toFixed(1)}°C` : "—",
    },
    { label: "Total Precipitation", value: `${totalPrecip.toFixed(1)} mm` },
    {
      label: "Avg Wind Speed",
      value: avgWind != null ? `${avgWind.toFixed(1)} km/h` : "—",
    },
    { label: "Dominant Conditions", value: dominantDesc },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "0.75rem",
        marginBottom: "1.5rem",
      }}
    >
      {cards.map((c) => (
        <div
          key={c.label}
          style={{
            background: "var(--bg-card, #1a1a2e)",
            border: "1px solid var(--border, #2a2a4a)",
            borderRadius: "8px",
            padding: "1rem",
          }}
        >
          <div
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted, #888)",
              marginBottom: "0.4rem",
            }}
          >
            {c.label}
          </div>
          <div
            style={{
              fontSize: "1.2rem",
              fontWeight: 600,
              color: "var(--text, #fff)",
            }}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Temperature band chart ────────────────────────────────────────────────────

function TemperatureChart({ rows }: { rows: WeatherRow[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 800,
    H = 240,
    mt = 20,
    mr = 20,
    mb = 40,
    ml = 50;
  const iW = W - ml - mr;
  const iH = H - mt - mb;

  useEffect(() => {
    if (!svgRef.current || rows.length === 0) return;

    const svg = d3Selection.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g").attr("transform", `translate(${ml},${mt})`);

    const dates = rows.map((r) => new Date(r.date));
    const allTemps = rows.flatMap((r) => [
      r.temperature_max ?? 0,
      r.temperature_min ?? 0,
    ]);
    const tempMin = Math.min(...allTemps);
    const tempMax = Math.max(...allTemps);
    const padding = (tempMax - tempMin) * 0.1 || 2;

    const xScale = d3Scale
      .scaleTime()
      .domain([dates[0], dates[dates.length - 1]])
      .range([0, iW]);

    const yScale = d3Scale
      .scaleLinear()
      .domain([tempMin - padding, tempMax + padding])
      .range([iH, 0]);

    // Gridlines
    g.append("g")
      .attr("class", "grid")
      .call(
        d3Axis
          .axisLeft(yScale)
          .tickSize(-iW)
          .tickFormat(() => ""),
      )
      .call((g) => g.select(".domain").remove())
      .call((g) =>
        g
          .selectAll(".tick line")
          .attr("stroke", "var(--border, #2a2a4a)")
          .attr("stroke-opacity", 0.5),
      );

    // Temperature band area
    const area = d3Shape
      .area<WeatherRow>()
      .x((d) => xScale(new Date(d.date)))
      .y0((d) => yScale(d.temperature_min ?? 0))
      .y1((d) => yScale(d.temperature_max ?? 0))
      .curve(d3Shape.curveCatmullRom);

    g.append("path")
      .datum(rows)
      .attr("fill", "rgba(251, 191, 36, 0.25)")
      .attr("stroke", "none")
      .attr("d", area);

    // Centre midpoint line
    const midLine = d3Shape
      .line<WeatherRow>()
      .x((d) => xScale(new Date(d.date)))
      .y((d) =>
        yScale(((d.temperature_max ?? 0) + (d.temperature_min ?? 0)) / 2),
      )
      .curve(d3Shape.curveCatmullRom);

    g.append("path")
      .datum(rows)
      .attr("fill", "none")
      .attr("stroke", "rgba(251, 191, 36, 0.8)")
      .attr("stroke-width", 1.5)
      .attr("d", midLine);

    // Axes
    const tickCount =
      rows.length <= 14 ? rows.length : Math.ceil(rows.length / 7);
    g.append("g")
      .attr("transform", `translate(0,${iH})`)
      .call(
        d3Axis
          .axisBottom(xScale)
          .ticks(tickCount)
          .tickFormat((d) => {
            const date = d as Date;
            return `${date.getDate()} ${date.toLocaleString("en-GB", { month: "short" })}`;
          }),
      )
      .call((g) => g.select(".domain").attr("stroke", "var(--border, #2a2a4a)"))
      .call((g) =>
        g
          .selectAll("text")
          .attr("fill", "var(--text-muted, #888)")
          .attr("font-size", "11px"),
      );

    g.append("g")
      .call(d3Axis.axisLeft(yScale).tickFormat((d) => `${d}°C`))
      .call((g) => g.select(".domain").attr("stroke", "var(--border, #2a2a4a)"))
      .call((g) =>
        g
          .selectAll("text")
          .attr("fill", "var(--text-muted, #888)")
          .attr("font-size", "11px"),
      );

    // Y axis label
    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -iH / 2)
      .attr("y", -38)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--text-muted, #888)")
      .attr("font-size", "11px")
      .text("°C");
  }, [rows]);

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div
        style={{
          fontSize: "0.8rem",
          color: "var(--text-muted, #888)",
          marginBottom: "0.5rem",
          fontWeight: 500,
        }}
      >
        TEMPERATURE RANGE
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: "block" }}
      />
    </div>
  );
}

// ── Precipitation bar chart ───────────────────────────────────────────────────

function PrecipitationChart({ rows }: { rows: WeatherRow[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 800,
    H = 240,
    mt = 20,
    mr = 20,
    mb = 40,
    ml = 50;
  const iW = W - ml - mr;
  const iH = H - mt - mb;

  useEffect(() => {
    if (!svgRef.current || rows.length === 0) return;

    const svg = d3Selection.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g").attr("transform", `translate(${ml},${mt})`);

    const xScale = d3Scale
      .scaleBand()
      .domain(rows.map((r) => r.date))
      .range([0, iW])
      .padding(0.15);

    const maxPrecip = Math.max(...rows.map((r) => r.precipitation ?? 0));
    const yScale = d3Scale
      .scaleLinear()
      .domain([0, maxPrecip * 1.1 || 1])
      .range([iH, 0]);

    // Bars
    g.selectAll(".bar")
      .data(rows)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (d) => xScale(d.date) ?? 0)
      .attr("y", (d) => yScale(d.precipitation ?? 0))
      .attr("width", xScale.bandwidth())
      .attr("height", (d) => Math.max(1, iH - yScale(d.precipitation ?? 0)))
      .attr("fill", "rgba(59, 130, 246, 0.7)")
      .attr("rx", 2);

    // Axes
    const tickCount =
      rows.length <= 14 ? rows.length : Math.ceil(rows.length / 7);
    const tickDates = rows
      .filter((_, i) => i % Math.ceil(rows.length / tickCount) === 0)
      .map((r) => r.date);

    g.append("g")
      .attr("transform", `translate(0,${iH})`)
      .call(
        d3Axis
          .axisBottom(xScale)
          .tickValues(tickDates)
          .tickFormat((d) => {
            const date = new Date(d);
            return `${date.getDate()} ${date.toLocaleString("en-GB", { month: "short" })}`;
          }),
      )
      .call((g) => g.select(".domain").attr("stroke", "var(--border, #2a2a4a)"))
      .call((g) =>
        g
          .selectAll("text")
          .attr("fill", "var(--text-muted, #888)")
          .attr("font-size", "11px"),
      );

    g.append("g")
      .call(d3Axis.axisLeft(yScale).tickFormat((d) => `${d}mm`))
      .call((g) => g.select(".domain").attr("stroke", "var(--border, #2a2a4a)"))
      .call((g) =>
        g
          .selectAll("text")
          .attr("fill", "var(--text-muted, #888)")
          .attr("font-size", "11px"),
      );

    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -iH / 2)
      .attr("y", -38)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--text-muted, #888)")
      .attr("font-size", "11px")
      .text("mm");
  }, [rows]);

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div
        style={{
          fontSize: "0.8rem",
          color: "var(--text-muted, #888)",
          marginBottom: "0.5rem",
          fontWeight: 500,
        }}
      >
        PRECIPITATION
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: "block" }}
      />
    </div>
  );
}

// ── Conditions timeline ───────────────────────────────────────────────────────

function ConditionsTimeline({ rows }: { rows: WeatherRow[] }) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <div
        style={{
          fontSize: "0.8rem",
          color: "var(--text-muted, #888)",
          marginBottom: "0.5rem",
          fontWeight: 500,
        }}
      >
        CONDITIONS
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
        {rows.map((r) => (
          <div
            key={r.id}
            style={{
              background: "var(--bg-card, #1a1a2e)",
              border: "1px solid var(--border, #2a2a4a)",
              borderRadius: "6px",
              padding: "0.35rem 0.6rem",
              fontSize: "0.75rem",
              color: "var(--text-muted, #888)",
            }}
          >
            <span style={{ color: "var(--text, #fff)", fontWeight: 500 }}>
              {new Date(r.date).getDate()}{" "}
              {new Date(r.date).toLocaleString("en-GB", { month: "short" })}
            </span>
            {" · "}
            {r.description ?? "—"}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── DashboardView (main export) ───────────────────────────────────────────────

function DashboardView({ results }: { results: any[] }) {
  const rows = results as WeatherRow[];
  const isMultiDay = rows.length > 1;

  return (
    <div style={{ padding: "1rem 0" }}>
      <MetricCards rows={rows} />
      {isMultiDay && <TemperatureChart rows={rows} />}
      {isMultiDay && <PrecipitationChart rows={rows} />}
      <ConditionsTimeline rows={rows} />
    </div>
  );
}

// ── ResultRenderer ────────────────────────────────────────────────────────────

function ResultRenderer({
  result,
  onRefine,
  onFollowUp,
  onChipAction,
}: {
  result: ExecuteResult;
  onRefine: () => void;
  onFollowUp: (query: ExecuteBody) => void;
  onChipAction: (chip: Chip) => void;
}) {
  const { plan, viz_hint, count, months_fetched, results, resultContext } =
    result;

  const safeContext: ResultContext = resultContext ?? {
    status: "exact",
    followUps: [],
    confidence: "high",
  };

  const followUps = safeContext.followUps ?? [];
  const chips = result.chips ?? [];

  return (
    <div className="result-panel">
      <div className="result-header">
        <div className="result-summary">
          <span className="result-count">{count}</span>
          <span className="result-desc">
            {result.intent === "weather"
              ? `day${count !== 1 ? "s" : ""}`
              : `${formatCategory(plan.category).toLowerCase()} result${count !== 1 ? "s" : ""}`}
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
      ) : viz_hint === "dashboard" ? (
        <DashboardView results={results} />
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

      {count > 0 && chips.length > 0 && (
        <ActionChips chips={chips} onAction={onChipAction} />
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
  const [clarification, setClarification] = useState<{ request: ClarificationRequest; executeBody: ExecuteBody } | null>(null);
  const [refineText, setRefineText] = useState("");
  const [showWorkspaces, setShowWorkspaces] = useState(false);
  const [lastQueryId, setLastQueryId] = useState<string | null>(null);
  const [lastSnapshotId, setLastSnapshotId] = useState<string | null>(null);
  const [pinTarget, setPinTarget] = useState<string | null>(null);

  const handleQuery = async (text: string) => {
    setStage("loading");
    setLoadingStage("interpreting");
    setIntentError(null);
    setParsed(null);
    setResult(null);

    // Step 1 — parse
    let parseData: ParsedQuery | null = null;
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

    if (!parseData) return; // ← move it here

    // Step 2 — execute
    setLoadingStage("fetching");
    try {
      const res = await fetch(`${API}/query/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(parseData as object), rawText: text }),
      });
      const data = await res.json();

      // D.1 — clarification response
      if (data.type === "clarification") {
        setClarification({ request: data.request, executeBody: parseData as ExecuteBody });
        setStage("done");
        setLoadingStage(null);
        return;
      }

      if (!res.ok || data.error) {
        setIntentError({
          error: data.error ?? "execute_error",
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
      setClarification(null);
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
    setClarification(null);
    setRefineText("");
  };

  // D.2 — user submitted clarification answers — re-execute with answers in rawText
  const handleClarificationSubmit = async (answers: Record<string, string>) => {
    if (!clarification) return;
    const answerText = Object.entries(answers)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    // Re-run execute with answers appended to rawText so the orchestrator
    // can match them against regulatory rules (D.4+)
    const body = {
      ...clarification.executeBody,
      rawText: `${clarification.request.intent} — ${answerText}`,
    };
    setStage("loading");
    setLoadingStage("fetching");
    setClarification(null);
    try {
      const res = await fetch(`${API}/query/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setIntentError({
          error: data.error ?? "execute_error",
          understood: {},
          missing: [],
          message: data.message ?? "Execution failed.",
        });
        setStage("error");
      } else {
        setResult(data);
        setStage("done");
      }
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

  // C.7 / C.11 — action chip dispatch
  const handleChipAction = async (chip: Chip) => {
    if (!result) return;

    if (chip.action === "show_map") {
      setResult({ ...result, viz_hint: "map" });
      return;
    }
    if (chip.action === "show_chart") {
      setResult({ ...result, viz_hint: "bar" });
      return;
    }

    // C.11 — cinema showtimes via /query/chip
    if (chip.action === "fetch_domain" && chip.args.domain === "cinema-showtimes") {
      // Extract cinema name from the current result rows
      const rows = result.results as Array<Record<string, unknown>>;
      const cinemaName =
        (rows[0]?.description as string) ??
        (rows[0]?.name as string) ??
        result.plan.location;

      setStage("loading");
      setLoadingStage("fetching");

      try {
        const res = await fetch(`${API}/query/chip`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "fetch_domain",
            args: { domain: "cinema-showtimes", cinemaName, ref: chip.args.ref },
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setIntentError({
            error: "chip_error",
            understood: {},
            missing: [],
            message: data.message ?? "Could not fetch showtimes.",
          });
          setStage("error");
        } else {
          // Show showtimes as a table result
          setResult({
            ...result,
            count: data.rows?.length ?? 0,
            results: data.rows ?? [],
            viz_hint: "table",
            intent: "cinema showtimes",
          });
          setStage("done");
        }
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
      return;
    }

    // All other actions — log for now
    console.log("[chip]", chip.action, chip.args);
  };

  const { setExecuteQuery } = useDredgeStore();

  useEffect(() => {
    setExecuteQuery(handleFollowUp);
  }, []);

  return (
    <>
      <style>{CSS + CAROUSEL_CSS}</style>
      <div className="app">
        <header className="app-header">
          <div className="logo">DREDGE</div>
          <div className="logo-sub">public data explorer</div>
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

          {stage === "done" && clarification && (
            <ClarificationPanel
              request={clarification.request}
              onSubmit={handleClarificationSubmit}
              onDismiss={handleRefine}
            />
          )}

          {stage === "done" && result && !clarification && (
            <ResultRenderer
              result={result}
              onRefine={handleRefine}
              onFollowUp={handleFollowUp}
              onChipAction={handleChipAction}
            />
          )}
        </main>

        <footer className="app-footer">
          Data: data.police.uk · Geocoding: Nominatim/OSM · Police data lags
          ~2–3 months
        </footer>
        {showWorkspaces && (
          <div className="ws-sidebar">
            <div className="ws-sidebar-header">
              <span>Workspaces</span>
              <button
                className="btn-ghost small"
                onClick={() => setShowWorkspaces(false)}
              >
                ✕
              </button>
              <button
                className="btn-ghost small"
                onClick={() => setShowWorkspaces(true)}
              >
                Save to workspace
              </button>
            </div>
            <WorkspacesPanel
              userId="local-user"
              onPinQuery={async (workspaceId) => {
                if (!lastQueryId) return;
                await fetch(
                  `http://localhost:3001/workspaces/${workspaceId}/queries`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "x-user-id": "local-user",
                    },
                    body: JSON.stringify({
                      queryId: lastQueryId,
                      snapshotId: lastSnapshotId,
                      title: "Pinned query",
                    }),
                  },
                );
                setShowWorkspaces(false);
              }}
            />
          </div>
        )}
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

  /* ── Clarification Panel (D.2) ── */

  .clarification-panel {
    border: 1px solid rgba(80, 200, 220, 0.25);
    background: rgba(80, 200, 220, 0.04);
    padding: 24px 28px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .clarification-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .clarification-label {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    color: rgba(80, 200, 220, 0.7);
  }

  .clarification-intent {
    font-size: 13px;
    color: var(--text-mid);
    margin: 0;
  }

  .clarification-intent strong {
    color: var(--text);
  }

  .clarification-fields {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .clarification-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .clarification-prompt {
    font-size: 12px;
    color: var(--text);
    font-family: var(--mono);
  }

  .clarification-select,
  .clarification-input {
    background: rgba(255,255,255,0.04);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: var(--mono);
    font-size: 12px;
    padding: 6px 10px;
    width: 100%;
    max-width: 320px;
  }

  .clarification-select:focus,
  .clarification-input:focus {
    outline: none;
    border-color: rgba(80, 200, 220, 0.5);
  }

  .clarification-bool {
    display: flex;
    gap: 8px;
  }

  .clarification-bool-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-mid);
    font-family: var(--mono);
    font-size: 12px;
    padding: 5px 18px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .clarification-bool-btn.selected {
    background: rgba(80, 200, 220, 0.12);
    border-color: rgba(80, 200, 220, 0.5);
    color: rgba(80, 200, 220, 1);
  }

  .clarification-submit {
    align-self: flex-start;
    background: rgba(80, 200, 220, 0.1);
    border: 1px solid rgba(80, 200, 220, 0.4);
    color: rgba(80, 200, 220, 0.9);
    font-family: var(--mono);
    font-size: 12px;
    padding: 7px 20px;
    cursor: pointer;
    letter-spacing: 0.04em;
    transition: all 0.15s;
  }

  .clarification-submit:hover:not(:disabled) {
    background: rgba(80, 200, 220, 0.2);
    color: rgba(80, 200, 220, 1);
  }

  .clarification-submit:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  /* ── Action Chips (C.7) ── */

  .action-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 0 2px;
  }

  .action-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(80, 200, 220, 0.06);
    border: 1px solid rgba(80, 200, 220, 0.25);
    color: rgba(80, 200, 220, 0.85);
    font-family: var(--mono);
    font-size: 11px;
    padding: 5px 12px;
    cursor: pointer;
    letter-spacing: 0.03em;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .action-chip:hover {
    background: rgba(80, 200, 220, 0.14);
    color: rgba(80, 200, 220, 1);
    border-color: rgba(80, 200, 220, 0.5);
  }

  .action-chip-icon {
    font-size: 10px;
    opacity: 0.7;
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

  .ws-sidebar {
  position: fixed;
  top: 0;
  right: 0;
  width: 360px;
  height: 100vh;
  background: var(--bg2);
  border-left: 1px solid var(--border);
  z-index: 100;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  animation: slideIn 0.2s ease;
}

.ws-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  font-family: var(--mono);
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--text-mid);
}

.workspaces-panel {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ws-title {
  font-family: var(--display);
  font-size: 16px;
  color: var(--text);
  margin: 0;
}

.ws-create {
  display: flex;
  gap: 8px;
}

.ws-input {
  flex: 1;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  font-family: var(--mono);
  font-size: 12px;
  padding: 7px 12px;
  outline: none;
}

.ws-input:focus { border-color: var(--amber); }

.ws-btn {
  background: var(--amber);
  color: #000;
  border: none;
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 700;
  padding: 7px 14px;
  cursor: pointer;
  letter-spacing: 0.06em;
}

.ws-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.ws-empty { color: var(--text-dim); font-size: 12px; }

.ws-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ws-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
}

.ws-name { font-size: 13px; color: var(--text); }

.ws-pin-btn {
  background: transparent;
  border: 1px solid var(--amber-dim);
  color: var(--amber);
  font-family: var(--mono);
  font-size: 11px;
  padding: 4px 10px;
  cursor: pointer;
}

.ws-pin-btn:hover { background: rgba(245,166,35,0.1); }

.ws-loading { color: var(--text-dim); font-size: 12px; padding: 16px 20px; }

@keyframes slideIn {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
`;
