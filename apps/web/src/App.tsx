import { useState, useEffect, useRef } from "react";
import { VideoPlayer } from "./components/video/VideoPlayer";
import { resolveSpec } from "./components/video/mockSpecs";
import type { VideoSpec } from "./components/video/types";
import { WorkspacesPanel } from "./components/WorkspacesPanel";
import {
  QueryHistoryCarousel,
  CAROUSEL_CSS,
} from "./components/QueryHistoryCarousel";
import { VizRenderer } from "./components/VizRenderer";
import { useDredgeStore } from "./store";
import { API } from "./api";
import { buildVizSpec } from "./types";
import type { QueryRow, AggregatedBin, VizHint } from "./types";

// ── Session ──────────────────────────────────────────────────────────────────

function getSessionId(): string {
  const KEY = "dredge_session_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

const SESSION_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "x-session-id": getSessionId(),
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface QueryPlan {
  category: string;
  date_from: string;
  date_to: string;
  location: string;
  temporal?: string;
}

interface SuggestedWorkflow {
  workflow_id: string;
  workflow_name: string;
  description: string;
  input_schema: WorkflowInputField[];
}

interface ParsedQuery {
  plan: QueryPlan;
  poly: string;
  viz_hint: VizHint;
  resolved_location: string;
  country_code: string;
  intent: string;
  months: string[];
  suggested_workflow?: SuggestedWorkflow;
  temporal?: string;
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
  | "show_table"
  | "clarify"
  | "play_video";

interface ChipArgs {
  ref?: string;
  domain?: string;
  intent?: string;
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

// D.3 — DecisionResult (returned by RegulatoryAdapter after attributes collected)
interface DecisionResult {
  eligibility: "eligible" | "conditional" | "ineligible";
  conditions: string[];
  next_questions: ClarificationField[];
  references: string[];
  suggested_chips?: Chip[];
}

// D.12 — Workflow types
interface WorkflowInputField {
  field: string;
  prompt: string;
  input_type: "text" | "number" | "select" | "boolean";
  options?: string[];
  required: boolean;
}

interface WorkflowStepResult {
  step_id: string;
  output_key: string;
  status: "success" | "skipped" | "error" | "not_implemented";
  error?: string;
  rows?: Record<string, unknown>[];
}

interface WorkflowResult {
  workflow_id: string;
  status: "complete" | "partial" | "failed";
  step_results: WorkflowStepResult[];
  handles: unknown[];
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
  results: QueryRow[] | AggregatedBin[];
  cache_hit: boolean;
  resultContext?: ResultContext;
  aggregated: boolean;
  intent: string;
  chips?: Chip[];
  activeFilter?: { field: string; value: string };
  source_label?: string | null;
  data_freshness?: string | null;
  empty_suggestion?: string | null;
  insight?: string | null;
}

interface IntentError {
  error: string;
  understood: Partial<QueryPlan>;
  missing: string[];
  message: string;
}

// A chip follow-up response — appended to the result stack below the primary result.
interface ChipResultEntry {
  handle: string;
  label: string;     // chip.label used as card heading
  domain: string;    // chip.args.domain
  rows: Record<string, unknown>[];
  viz_hint: VizHint;
  chips: Chip[];
  count: number;
}

type Stage = "idle" | "loading" | "done" | "error";

// ── Helpers ───────────────────────────────────────────────────────────────────


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
function formatTemporalDisplay(
  temporal: string | undefined,
  date_from: string,
  date_to: string,
): string {
  if (temporal && temporal !== "unspecified") {
    // Capitalise first letter for display
    return temporal.charAt(0).toUpperCase() + temporal.slice(1);
  }
  if (date_from === date_to) {
    return formatMonth(date_from);
  }
  return `${formatMonth(date_from)} – ${formatMonth(date_to)}`;
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
  show_table:       "☰",
  calculate_travel: "→",
  fetch_domain:     "⊕",
  filter_by:        "⊘",
  overlay_spatial:  "⊞",
  compare_location: "⇄",
  play_video:       "▶",
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
        <button className="btn-ghost small" onClick={onDismiss}>
          ✕
        </button>
      </div>
      <p className="clarification-intent">
        To check eligibility for <strong>{request.intent}</strong>, please
        answer:
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
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
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
                placeholder={
                  q.input_type === "number" ? "Enter a number" : "Your answer"
                }
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

// ── DiscoveringCard — shown while domain auto-discovery pipeline is running ───

function DiscoveringCard({
  intent,
  message,
  status,
  onDismiss,
}: {
  intent: string;
  message: string;
  status: "searching" | "review" | "error";
  onDismiss: () => void;
}) {
  const statusLine =
    status === "review"
      ? "Source found — waiting for admin review"
      : status === "error"
      ? "Discovery failed — no source found"
      : message;

  return (
    <div style={{ border: "1px solid rgba(232,184,75,0.3)", borderRadius: 6, padding: "20px 24px", background: "rgba(232,184,75,0.04)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "#e8b84b", fontFamily: "monospace" }}>
          {status === "searching" ? "⟳ Discovering" : status === "review" ? "⏸ Under Review" : "✕ Not Found"}
        </div>
        <button className="btn-ghost small" onClick={onDismiss}>✕ Dismiss</button>
      </div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{intent}</div>
      <div style={{ fontSize: 13, color: "rgba(240,237,232,0.6)", lineHeight: 1.5 }}>{statusLine}</div>
      {status === "searching" && (
        <div style={{ marginTop: 14, height: 2, background: "rgba(232,184,75,0.15)", borderRadius: 1, overflow: "hidden" }}>
          <div style={{ height: "100%", width: "40%", background: "#e8b84b", borderRadius: 1, animation: "slide 1.4s ease-in-out infinite" }} />
        </div>
      )}
    </div>
  );
}

// ── DecisionResultPanel — Phase D.3 ──────────────────────────────────────────

export function DecisionResultPanel({
  intent,
  decision,
  onDismiss,
  onChipAction,
}: {
  intent: string;
  decision: DecisionResult;
  onDismiss: () => void;
  onChipAction?: (chip: Chip) => void;
}) {
  const isEligible = decision.eligibility === "eligible";
  const isConditional = decision.eligibility === "conditional";

  const badgeColor = isEligible
    ? "var(--green, #3ddc84)"
    : isConditional
      ? "var(--amber, #f5a623)"
      : "var(--red, #ff4d4d)";

  const badgeLabel = isEligible
    ? "ELIGIBLE"
    : isConditional
      ? "CONDITIONAL"
      : "INELIGIBLE";

  const badgeBg = isEligible
    ? "rgba(61,220,132,0.12)"
    : isConditional
      ? "rgba(245,166,35,0.12)"
      : "rgba(255,77,77,0.12)";

  return (
    <div className="decision-panel">
      <div className="decision-header">
        <div
          className="decision-badge"
          style={{
            color: badgeColor,
            background: badgeBg,
            border: `1px solid ${badgeColor}`,
          }}
        >
          {badgeLabel}
        </div>
        <button className="btn-ghost small" onClick={onDismiss}>
          ✕ New query
        </button>
      </div>

      <div className="decision-intent">{intent}</div>

      {decision.conditions.length > 0 && (
        <div className="decision-section">
          <div className="decision-section-label">REQUIREMENTS</div>
          <ul className="decision-conditions">
            {decision.conditions.map((c, i) => (
              <li key={i} className="decision-condition">
                <span className="decision-check" style={{ color: badgeColor }}>
                  ✓
                </span>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {decision.next_questions.length > 0 && (
        <div className="decision-section">
          <div className="decision-section-label">MORE INFORMATION NEEDED</div>
          <ul className="decision-conditions">
            {decision.next_questions.map((q) => (
              <li key={q.field} className="decision-condition">
                <span
                  className="decision-check"
                  style={{ color: "var(--amber, #f5a623)" }}
                >
                  ?
                </span>
                {q.prompt}
              </li>
            ))}
          </ul>
        </div>
      )}

      {decision.references.length > 0 && (
        <div className="decision-section">
          <div className="decision-section-label">REFERENCES</div>
          <ul className="decision-refs">
            {decision.references.map((ref) => (
              <li key={ref}>
                <a
                  href={ref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="decision-ref-link"
                >
                  {ref}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {decision.suggested_chips &&
        decision.suggested_chips.length > 0 &&
        onChipAction && (
          <div className="decision-section">
            <div className="decision-section-label">SUGGESTED NEXT STEPS</div>
            <div className="chip-row" style={{ marginTop: "0.5rem" }}>
              {decision.suggested_chips.map((chip) => (
                <button
                  key={chip.label}
                  className="chip"
                  onClick={() => {
                    onDismiss();
                    onChipAction(chip);
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        )}
    </div>
  );
}

// ── WorkflowInputForm — Phase D.12 ───────────────────────────────────────────

function WorkflowInputForm({
  workflowName,
  inputSchema,
  description,
  onSubmit,
  onDismiss,
}: {
  workflowName: string;
  inputSchema: WorkflowInputField[];
  description?: string;
  onSubmit: (inputs: Record<string, unknown>) => void;
  onDismiss: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const inputs: Record<string, unknown> = {};
    for (const field of inputSchema) {
      const raw = values[field.field] ?? "";
      if (field.input_type === "number") {
        inputs[field.field] = raw === "" ? undefined : Number(raw);
      } else {
        inputs[field.field] = raw;
      }
    }
    onSubmit(inputs);
  };

  const set = (field: string, value: string) =>
    setValues((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="clarification-panel">
      <div className="clarification-header">
        <strong>{workflowName}</strong>
        <button className="btn-ghost small" onClick={onDismiss}>
          ✕
        </button>
      </div>
      {description && (
        <p
          style={{
            margin: "0 0 0.75rem",
            fontSize: "0.85rem",
            color: "var(--text-muted, #888)",
          }}
        >
          {description}
        </p>
      )}
      <form onSubmit={handleSubmit} className="clarification-form">
        {inputSchema.map((f) => (
          <div key={f.field} className="clarification-field">
            <label className="clarification-label">{f.prompt}</label>
            {f.input_type === "select" && f.options ? (
              <select
                className="clarification-input"
                value={values[f.field] ?? ""}
                onChange={(e) => set(f.field, e.target.value)}
                required={f.required}
              >
                <option value="">— select —</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="clarification-input"
                type={f.input_type === "number" ? "number" : "text"}
                value={values[f.field] ?? ""}
                onChange={(e) => set(f.field, e.target.value)}
                required={f.required}
                placeholder={f.input_type === "number" ? "0" : ""}
              />
            )}
          </div>
        ))}
        <button
          type="submit"
          className="btn-primary"
          style={{ marginTop: "0.75rem" }}
        >
          Run workflow
        </button>
      </form>
    </div>
  );
}

// ── WorkflowResultPanel — Phase D.12 ─────────────────────────────────────────

const STEP_ICONS: Record<WorkflowStepResult["status"], string> = {
  success: "✓",
  skipped: "↷",
  error: "✕",
  not_implemented: "○",
};

const STEP_COLORS: Record<WorkflowStepResult["status"], string> = {
  success: "var(--green, #3ddc84)",
  skipped: "var(--muted, #888)",
  error: "var(--red, #ff4d4d)",
  not_implemented: "var(--amber, #f5a623)",
};

const STATUS_LABEL: Record<WorkflowResult["status"], string> = {
  complete: "COMPLETE",
  partial: "PARTIAL",
  failed: "FAILED",
};

const STATUS_COLOR: Record<WorkflowResult["status"], string> = {
  complete: "var(--green, #3ddc84)",
  partial: "var(--amber, #f5a623)",
  failed: "var(--red, #ff4d4d)",
};

function WorkflowResultPanel({
  result,
  onDismiss,
}: {
  result: WorkflowResult;
  onDismiss: () => void;
}) {
  const color = STATUS_COLOR[result.status];

  // E.3 — hunting-day-plan renders an itinerary instead of raw step output
  const travelStep = result.step_results.find(
    (s) => s.step_id === "compute-travel-times",
  );
  const zoneStep = result.step_results.find((s) => s.step_id === "fetch-zones");
  const isHunting =
    result.workflow_id === "hunting-day-plan" &&
    travelStep?.status === "success" &&
    (travelStep.rows?.length ?? 0) > 0;

  if (isHunting) {
    const travelRows = travelStep!.rows!;
    const zoneRows = zoneStep?.rows ?? [];
    const closestZone = travelRows[0] as Record<string, unknown>;
    const zoneDetail = zoneRows.find(
      (z) => z.lat === closestZone.lat && z.lon === closestZone.lon,
    ) as Record<string, unknown> | undefined;

    return (
      <div className="decision-panel">
        <div className="decision-header">
          <div
            className="decision-badge"
            style={{
              color: "var(--green, #3ddc84)",
              background: "rgba(61,220,132,0.12)",
              border: "1px solid var(--green, #3ddc84)",
            }}
          >
            ITINERARY READY
          </div>
          <button className="btn-ghost small" onClick={onDismiss}>
            ✕ New query
          </button>
        </div>

        <div className="decision-intent">
          {String(closestZone.name ?? "Hunting zone")} —{" "}
          {String(closestZone.distance_km ?? "?")} km away
        </div>

        <div className="decision-section">
          <div className="decision-section-label">YOUR DAY</div>
          <ul className="decision-conditions">
            <li className="decision-condition">
              <span
                className="decision-check"
                style={{ color: "var(--green,#3ddc84)" }}
              >
                →
              </span>
              <span>
                <strong>07:00</strong> — Depart,{" "}
                {String(closestZone.travel_time_minutes ?? "?")} min travel by{" "}
                {String(closestZone.transport_mode ?? "")}
              </span>
            </li>
            <li className="decision-condition">
              <span
                className="decision-check"
                style={{ color: "var(--green,#3ddc84)" }}
              >
                ◉
              </span>
              <span>
                <strong>Arrive</strong> — {String(closestZone.name ?? "Zone")}
                {zoneDetail?.location ? `, ${String(zoneDetail.location)}` : ""}
              </span>
            </li>
            {zoneDetail?.value && (
              <li className="decision-condition">
                <span
                  className="decision-check"
                  style={{ color: "var(--muted,#888)" }}
                >
                  ·
                </span>
                <span>
                  {String(zoneDetail.value)} ha open access land ·{" "}
                  {String(zoneDetail.category ?? "Open Access Land")}
                </span>
              </li>
            )}
          </ul>
        </div>

        {travelRows.length > 1 && (
          <div className="decision-section">
            <div className="decision-section-label">OTHER ZONES IN RANGE</div>
            <ul className="decision-conditions">
              {travelRows.slice(1, 4).map((r, i) => {
                const row = r as Record<string, unknown>;
                return (
                  <li key={i} className="decision-condition">
                    <span
                      className="decision-check"
                      style={{ color: "var(--muted,#888)" }}
                    >
                      ·
                    </span>
                    <span>
                      {String(row.name ?? "Zone")} —{" "}
                      {String(row.distance_km ?? "?")} km (
                      {String(row.travel_time_minutes ?? "?")} min)
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="decision-panel">
      <div className="decision-header">
        <div
          className="decision-badge"
          style={{
            color,
            background: `${color}1a`,
            border: `1px solid ${color}`,
          }}
        >
          {STATUS_LABEL[result.status]}
        </div>
        <button className="btn-ghost small" onClick={onDismiss}>
          ✕ New query
        </button>
      </div>

      <div className="decision-intent">Workflow: {result.workflow_id}</div>

      <div className="decision-section">
        <div className="decision-section-label">STEPS</div>
        <ul className="decision-conditions">
          {result.step_results.map((step) => (
            <li key={step.step_id} className="decision-condition">
              <span
                className="decision-check"
                style={{ color: STEP_COLORS[step.status] }}
              >
                {STEP_ICONS[step.status]}
              </span>
              <span>
                <strong>{step.step_id}</strong>
                {step.error && (
                  <span
                    style={{
                      color: "var(--muted, #888)",
                      marginLeft: "0.5rem",
                      fontSize: "0.8em",
                    }}
                  >
                    — {step.error}
                  </span>
                )}
                {step.rows && step.rows.length > 0 && (
                  <span
                    style={{
                      color: "var(--green, #3ddc84)",
                      marginLeft: "0.5rem",
                      fontSize: "0.8em",
                    }}
                  >
                    ({step.rows.length} rows)
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
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
  suggestion,
}: {
  plan: QueryPlan;
  onRefine: () => void;
  resultContext: ResultContext;
  onFollowUp: (query: ExecuteBody) => void;
  suggestion?: string | null;
}) {
  return (
    <div className="empty-panel">
      <div className="empty-icon">○</div>
      <div className="empty-title">No results found</div>
      <p className="empty-message">
        {resultContext.reason ? (
          resultContext.reason
        ) : (
          <>
            No results found for{" "}
            <strong>{formatCategory(plan.category)}</strong> in{" "}
            {formatTemporalDisplay(plan.temporal, plan.date_from, plan.date_to)}
            .
          </>
        )}
      </p>
      <p className="empty-hint">
        {suggestion ?? "Try adjusting the date range or rephrasing your query."}
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

// ── MapView / BarChart / TableView / DashboardView ────────────────────────────
// Extracted to src/components/{MapView,BarChart,TableView,DashboardView}.tsx
// and composed via VizRenderer — see src/components/VizRenderer.tsx.

// ── StackCard — renders a single chip follow-up result in the result stack ────

function StackCard({
  entry,
  onChipAction,
}: {
  entry: ChipResultEntry;
  onChipAction: (chip: Chip) => void;
}) {
  const chips = (entry.chips ?? []).filter((c) => {
    if (c.action === "show_map" && entry.viz_hint === "map") return false;
    if (c.action === "show_table" && entry.viz_hint === "table") return false;
    return true;
  });

  return (
    <div className="result-panel stack-card">
      <div className="result-header">
        <div className="result-summary">
          <span className="result-count">{entry.count}</span>
          <span className="result-desc">results from {entry.label}</span>
        </div>
      </div>

      {entry.count === 0 ? (
        <p className="empty-hint">No data found for this area.</p>
      ) : (
        <VizRenderer
          spec={buildVizSpec(entry.viz_hint, entry.rows as QueryRow[])}
        />
      )}

      {chips.length > 0 && (
        <ActionChips chips={chips} onAction={onChipAction} />
      )}
    </div>
  );
}

// ── ResultRenderer ────────────────────────────────────────────────────────────

function ResultRenderer({
  result,
  onRefine,
  onNewQuery,
  onFollowUp,
  onChipAction,
}: {
  result: ExecuteResult;
  onRefine: () => void;
  onNewQuery: () => void;
  onFollowUp: (query: ExecuteBody) => void;
  onChipAction: (chip: Chip) => void;
}) {
  const {
    plan,
    viz_hint,
    count,
    months_fetched,
    results,
    resultContext,
    source_label,
    data_freshness,
    empty_suggestion,
    insight,
  } = result;

  const safeContext: ResultContext = resultContext ?? {
    status: "exact",
    followUps: [],
    confidence: "high",
  };

  const followUps = safeContext.followUps ?? [];
  // Filter chips that are redundant for the current viz:
  //   show_map   — already on map/heatmap
  //   show_table — already showing as table
  const chips = (result.chips ?? []).filter((c) => {
    if (c.action === "show_map" && (viz_hint === "map" || viz_hint === "heatmap")) return false;
    if (c.action === "show_table" && viz_hint === "table") return false;
    return true;
  });

  return (
    <div className="result-panel">
      <div className="result-header">
        <div className="result-summary">
          <span className="result-count">{count}</span>
          <span className="result-desc">
            {result.intent === "weather" || plan.category?.startsWith("weather")
              ? `day${count !== 1 ? "s" : ""} of weather data for ${plan.location}`
              : `${formatCategory(plan.category).toLowerCase()} result${count !== 1 ? "s" : ""}`}
          </span>
        </div>
        <button className="btn-ghost small" onClick={onNewQuery}>
          New query
        </button>
      </div>

      {safeContext.fallback && (
        <FallbackBanner fallback={safeContext.fallback} />
      )}

      {insight && <p className="result-insight">{insight}</p>}

      {count === 0 ? (
        <EmptyResults
          plan={plan}
          onRefine={onRefine}
          resultContext={safeContext}
          onFollowUp={onFollowUp}
          suggestion={empty_suggestion}
        />
      ) : (
        <VizRenderer
          spec={buildVizSpec(viz_hint, results, {
            aggregated: result.aggregated,
            months: months_fetched,
            activeFilter: result.activeFilter,
            onClearFilter: () =>
              onChipAction({
                label: "Clear filter",
                action: "filter_by",
                args: { field: "__clear__" },
              }),
          })}
        />
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

      {(source_label || data_freshness) && (
        <div className="result-attribution">
          {data_freshness && (
            <span className="data-freshness">
              Last updated: {data_freshness}
            </span>
          )}
          {source_label && (
            <span className="source-label">Source: {source_label}</span>
          )}
        </div>
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
  const [resultStack, setResultStack] = useState<ExecuteResult[]>([]);
  const [chipStack, setChipStack] = useState<ChipResultEntry[]>([]);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [synthesisLoading, setSynthesisLoading] = useState(false);
  const [videoSpec, setVideoSpec] = useState<VideoSpec | null>(null);
  const [intentError, setIntentError] = useState<IntentError | null>(null);
  const [clarification, setClarification] = useState<{
    request: ClarificationRequest;
    executeBody: ExecuteBody;
  } | null>(null);
  const [decisionResult, setDecisionResult] = useState<{
    decision: DecisionResult;
    intent: string;
  } | null>(null);
  const [workflowInput, setWorkflowInput] = useState<{
    workflow_id: string;
    workflow_name: string;
    description?: string;
    input_schema: WorkflowInputField[];
  } | null>(null);
  const [workflowResult, setWorkflowResult] = useState<WorkflowResult | null>(
    null,
  );
  const [refineText, setRefineText] = useState("");
  const [showWorkspaces, setShowWorkspaces] = useState(false);
  const [lastQueryId, setLastQueryId] = useState<string | null>(null);
  const [lastSnapshotId, setLastSnapshotId] = useState<string | null>(null);
  const [pinTarget, setPinTarget] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState<{
    discovery_id: string;
    intent: string;
    message: string;
    /** Body to re-execute once the adapter is registered */
    executeBody: ExecuteBody;
  } | null>(null);

  // Poll discovery status while a discovery is in progress.
  // On "registered" → auto-re-execute the original query.
  // On "requires_review" | "error" → stop polling, leave card visible.
  useEffect(() => {
    if (!discovering) return;
    const { discovery_id, executeBody } = discovering;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`${API}/query/discovery/${discovery_id}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();

        if (data.status === "registered") {
          if (!cancelled) {
            setDiscovering(null);
            // Re-execute the original query now that the adapter is live
            const execRes = await fetch(`${API}/query/execute`, {
              method: "POST",
              headers: SESSION_HEADERS,
              body: JSON.stringify(executeBody),
            });
            const execData = await execRes.json();
            handleExecuteResponse(execData, executeBody);
          }
          return; // stop polling
        }

        if (data.status === "requires_review") {
          setDiscovering((prev) =>
            prev ? { ...prev, message: "Source found — awaiting admin review before it goes live." } : prev
          );
          return;
        }
        if (data.status === "error") {
          setDiscovering((prev) =>
            prev ? { ...prev, message: "Discovery failed — no public data source found for this query." } : prev
          );
          return;
        }

        // Still pending — poll again after 4 s
        if (!cancelled) setTimeout(poll, 4000);
      } catch {
        if (!cancelled) setTimeout(poll, 8000);
      }
    };

    setTimeout(poll, 3000);
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discovering?.discovery_id]);

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
        headers: SESSION_HEADERS,
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

    if (!parseData) return;

    // D.15 — if parse identified a matching workflow, offer it before executing
    if (parseData.suggested_workflow) {
      const wf = parseData.suggested_workflow;
      setWorkflowInput({
        workflow_id: wf.workflow_id,
        workflow_name: wf.workflow_name,
        description: wf.description,
        input_schema: wf.input_schema,
      });
      setStage("done");
      setLoadingStage(null);
      return;
    }

    // Step 2 — execute
    setLoadingStage("fetching");
    try {
      const res = await fetch(`${API}/query/execute`, {
        method: "POST",
        headers: SESSION_HEADERS,
        body: JSON.stringify({ ...(parseData as object), rawText: text }),
      });
      const data = await res.json();

      // D.1 — clarification response
      if (data.type === "clarification") {
        setClarification({
          request: data.request,
          executeBody: parseData as ExecuteBody,
        });
        setStage("done");
        setLoadingStage(null);
        return;
      }

      // D.3 — decision result (regulatory adapter returned eligibility)
      if (data.type === "decision_result") {
        setDecisionResult({
          decision: data.decision,
          intent: data.intent ?? text,
        });
        setStage("done");
        setLoadingStage(null);
        return;
      }

      // Discovery in progress — show status card and begin polling
      if (data.type === "discovering") {
        setDiscovering({
          discovery_id: data.discovery_id,
          intent: data.intent ?? text,
          message: data.message ?? `Searching for a source for "${text}"…`,
          executeBody: { ...(parseData as ExecuteBody), rawText: text },
        });
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
      setChipStack([]);
      setSynthesis(null);
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

  /**
   * handleExecuteResponse — shared handler for /execute JSON responses.
   * Called from the poll effect when auto-retrying after a domain registers.
   */
  const handleExecuteResponse = (data: any, executeBody: ExecuteBody) => {
    if (data.type === "decision_result") {
      setDecisionResult({ decision: data.decision, intent: data.intent ?? "" });
      setStage("done");
      return;
    }
    if (data.type === "discovering") {
      setDiscovering({
        discovery_id: data.discovery_id,
        intent: data.intent ?? "",
        message: data.message ?? "Searching for a source…",
        executeBody,
      });
      setStage("done");
      return;
    }
    if (data.error) {
      setIntentError({ error: data.error, understood: {}, missing: [], message: data.message ?? "" });
      setStage("error");
      return;
    }
    setParsed(executeBody);
    setResult(data);
    setChipStack([]);
    setSynthesis(null);
    setDiscovering(null);
    setStage("done");
  };

  // Follow-up chips call /execute directly — no /parse round-trip
  const handleFollowUp = async (query: ExecuteBody) => {
    setStage("loading");
    setLoadingStage("fetching");
    setResult(null);

    try {
      const res = await fetch(`${API}/query/execute`, {
        method: "POST",
        headers: SESSION_HEADERS,
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

  // Full reset — blank input, all state cleared. Used by "✕ New query" buttons.
  const handleNewQuery = () => {
    setStage("idle");
    setResult(null);
    setParsed(null);
    setIntentError(null);
    setClarification(null);
    setDecisionResult(null);
    setWorkflowInput(null);
    setWorkflowResult(null);
    setRefineText("");
    setChipStack([]);
    setSynthesis(null);
    setDiscovering(null);
  };

  // Soft reset — returns to input with the last query pre-populated for editing.
  // Used by "Refine ↩" and "Refine query" buttons.
  const handleRefine = () => {
    setStage("idle");
  };

  // D.2/D.3 — user submitted clarification answers — re-execute with user_attributes
  const handleClarificationSubmit = async (answers: Record<string, string>) => {
    if (!clarification) return;
    // Send answers as structured user_attributes (D.4 wire-up reads these directly)
    const body = {
      ...clarification.executeBody,
      rawText: clarification.request.intent,
      user_attributes: answers,
    };
    setStage("loading");
    setLoadingStage("fetching");
    setClarification(null);
    try {
      const res = await fetch(`${API}/query/execute`, {
        method: "POST",
        headers: SESSION_HEADERS,
        body: JSON.stringify(body),
      });
      const data = await res.json();

      // D.3 — regulatory adapter returned a decision
      if (data.type === "decision_result") {
        setDecisionResult({
          decision: data.decision,
          intent: data.intent ?? clarification.request.intent,
        });
        setStage("done");
      } else if (!res.ok || data.error) {
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
    // play_video doesn't need a result — handle it before the guard
    if (chip.action === "play_video") {
      const spec = resolveSpec({ intent: chip.args.intent, domain: chip.args.domain });
      if (spec) setVideoSpec(spec);
      return;
    }

    if (!result) return;

    if (chip.action === "show_map") {
      setResult({ ...result, viz_hint: "map" });
      return;
    }
    if (chip.action === "show_chart") {
      setResult({ ...result, viz_hint: "bar" });
      return;
    }
    if (chip.action === "show_table") {
      setResult({ ...result, viz_hint: "table" });
      return;
    }

    // D.14 — filter_by: client-side category filter, no round-trip needed
    if (chip.action === "filter_by") {
      // __clear__ is the sentinel emitted by the "Clear filter" button
      if (chip.args.field === "__clear__") {
        setResult({ ...result, activeFilter: undefined });
        return;
      }
      if (chip.args.field === "category") {
        // Pick the most common category from results as the default, or
        // use chip.args.value if the backend supplied one
        const rows = result.results as unknown as Record<string, unknown>[];
        const value =
          chip.args.value != null
            ? String(chip.args.value)
            : (() => {
                const freq: Record<string, number> = {};
                for (const r of rows) {
                  const c = String(r.category ?? "");
                  if (c) freq[c] = (freq[c] ?? 0) + 1;
                }
                return (
                  Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""
                );
              })();
        if (value) {
          setResult({
            ...result,
            viz_hint: "table",
            activeFilter: { field: "category", value },
          });
        }
        return;
      }
      return;
    }

    // C.11 — cinema showtimes via /query/chip
    if (
      chip.action === "fetch_domain" &&
      chip.args.domain === "cinema-showtimes"
    ) {
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
          headers: SESSION_HEADERS,
          body: JSON.stringify({
            action: "fetch_domain",
            args: {
              domain: "cinema-showtimes",
              cinemaName,
              ref: chip.args.ref,
            },
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

    // D.12 — calculate_travel: request workflow inputs from backend then show form
    if (chip.action === "calculate_travel") {
      try {
        const res = await fetch(`${API}/query/chip`, {
          method: "POST",
          headers: SESSION_HEADERS,
          body: JSON.stringify({ action: "calculate_travel", args: chip.args }),
        });
        const data = await res.json();
        if (data.type === "workflow_input_required") {
          setWorkflowInput({
            workflow_id: data.workflow_id,
            workflow_name: data.workflow_name,
            input_schema: data.input_schema,
          });
          setStage("done");
        }
      } catch (err: any) {
        console.error("[chip:calculate_travel]", err);
      }
      return;
    }

    // E.3 — fetch_domain: hunting-day-plan → show workflow input form
    if (
      chip.action === "fetch_domain" &&
      chip.args.domain === "hunting-day-plan"
    ) {
      try {
        const res = await fetch(`${API}/query/chip`, {
          method: "POST",
          headers: SESSION_HEADERS,
          body: JSON.stringify({
            action: "fetch_domain",
            args: { domain: "hunting-day-plan" },
          }),
        });
        const data = await res.json();
        if (data.type === "workflow_input_required") {
          setWorkflowInput({
            workflow_id: data.workflow_id,
            workflow_name: data.workflow_name,
            description: data.description,
            input_schema: data.input_schema,
          });
          setStage("done");
        }
      } catch (err: any) {
        console.error("[chip:hunting-day-plan]", err);
      }
      return;
    }

    // Generic fetch_domain — routes to any registered adapter via W.1 backend handler.
    // The backend reads active_plan / active_poly from session context (W.2) so we
    // don't need to pass the plan explicitly here.
    if (chip.action === "fetch_domain") {
      try {
        const res = await fetch(`${API}/query/chip`, {
          method: "POST",
          headers: SESSION_HEADERS,
          body: JSON.stringify({ chip }),
        });
        const data = await res.json();
        if (data.type === "ephemeral" && Array.isArray(data.rows)) {
          setChipStack((prev) => [
            ...prev,
            {
              handle:   data.handle ?? crypto.randomUUID(),
              label:    chip.label,
              domain:   chip.args.domain ?? "unknown",
              rows:     data.rows,
              viz_hint: data.viz_hint ?? "table",
              chips:    data.chips ?? [],
              count:    data.rows.length,
            },
          ]);
        }
      } catch (err: any) {
        console.error("[chip:fetch_domain]", err);
      }
      return;
    }

    console.log("[chip] unhandled action:", chip.action, chip.args);
  };

  // Phase C — synthesise across the full result stack
  const handleSynthesise = async () => {
    if (!result || chipStack.length === 0) return;
    setSynthesisLoading(true);
    setSynthesis(null);

    // Build the stack payload: primary result first, then chip follow-ups
    const stackPayload = [
      {
        domain: result.intent ?? "unknown",
        rows:    (result.results ?? []) as Record<string, unknown>[],
        vizHint: result.viz_hint,
      },
      ...chipStack.map((e) => ({
        domain:  e.domain,
        rows:    e.rows,
        vizHint: e.viz_hint,
      })),
    ];

    try {
      const res = await fetch(`${API}/query/synthesise`, {
        method: "POST",
        headers: SESSION_HEADERS,
        body: JSON.stringify({
          stack:    stackPayload,
          location: result.resolved_location ?? result.plan?.location ?? "",
        }),
      });
      const data = await res.json();
      setSynthesis(data.synthesis ?? null);
    } catch (err: any) {
      console.error("[synthesise]", err);
    }
    setSynthesisLoading(false);
  };

  // D.12 — submit workflow inputs → /query/workflow
  const handleWorkflowSubmit = async (inputs: Record<string, unknown>) => {
    if (!workflowInput) return;
    setWorkflowInput(null);
    setStage("loading");
    setLoadingStage("fetching");
    try {
      const res = await fetch(`${API}/query/workflow`, {
        method: "POST",
        headers: SESSION_HEADERS,
        body: JSON.stringify({
          workflow_id: workflowInput.workflow_id,
          inputs,
        }),
      });
      const data = await res.json();
      if (data.type === "workflow_result") {
        setWorkflowResult(data.result);
        setStage("done");
      } else {
        setIntentError({
          error: "workflow_error",
          understood: {},
          missing: [],
          message: data.message ?? "Workflow execution failed.",
        });
        setStage("error");
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
            <IntentErrorPanel error={intentError} onRetry={handleNewQuery} />
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
              onDismiss={handleNewQuery}
            />
          )}

          {stage === "done" && decisionResult && !clarification && (
            <DecisionResultPanel
              intent={decisionResult.intent}
              decision={decisionResult.decision}
              onDismiss={handleNewQuery}
              onChipAction={handleChipAction}
            />
          )}

          {stage === "done" && discovering && !decisionResult && !clarification && (
            <DiscoveringCard
              intent={discovering.intent}
              message={discovering.message}
              status={
                discovering.message.includes("awaiting admin") ? "review" :
                discovering.message.includes("failed") ? "error" :
                "searching"
              }
              onDismiss={handleNewQuery}
            />
          )}

          {stage === "done" && workflowInput && (
            <WorkflowInputForm
              workflowName={workflowInput.workflow_name}
              description={workflowInput.description}
              inputSchema={workflowInput.input_schema}
              onSubmit={handleWorkflowSubmit}
              onDismiss={handleNewQuery}
            />
          )}

          {stage === "done" && workflowResult && !workflowInput && (
            <WorkflowResultPanel
              result={workflowResult}
              onDismiss={handleNewQuery}
            />
          )}

          {stage === "done" &&
            result &&
            !clarification &&
            !decisionResult &&
            !workflowInput &&
            !workflowResult && (
              <>
                <ResultRenderer
                  result={result}
                  onRefine={handleRefine}
                  onNewQuery={handleNewQuery}
                  onFollowUp={handleFollowUp}
                  onChipAction={handleChipAction}
                />
                {chipStack.map((entry) => (
                  <StackCard
                    key={entry.handle}
                    entry={entry}
                    onChipAction={handleChipAction}
                  />
                ))}

                {/* Phase C — synthesis trigger and output */}
                {chipStack.length >= 1 && !synthesis && (
                  <div className="synthesis-prompt">
                    <button
                      className="btn-primary synthesis-btn"
                      onClick={handleSynthesise}
                      disabled={synthesisLoading}
                    >
                      {synthesisLoading ? "Analysing…" : "What does this tell me?"}
                    </button>
                  </div>
                )}

                {synthesis && (
                  <div className="synthesis-card">
                    <div className="synthesis-icon">◎</div>
                    <p className="synthesis-text">{synthesis}</p>
                    <button
                      className="btn-ghost small synthesis-dismiss"
                      onClick={() => setSynthesis(null)}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </>
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
                      ...SESSION_HEADERS,
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
      {/* Video guide modal — sits above everything, closed by videoSpec → null */}
      {videoSpec && (
        <VideoPlayer spec={videoSpec} onClose={() => setVideoSpec(null)} />
      )}
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

  /* ── Decision Result Panel (D.3) ── */

  .decision-panel {
    border: 1px solid rgba(61, 220, 132, 0.2);
    background: rgba(61, 220, 132, 0.03);
    padding: 24px 28px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .decision-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .decision-badge {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 3px;
  }

  .decision-intent {
    font-size: 15px;
    font-weight: 500;
    color: var(--text);
    text-transform: capitalize;
  }

  .decision-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .decision-section-label {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.12em;
    color: var(--text-dim);
  }

  .decision-conditions {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0;
    margin: 0;
  }

  .decision-condition {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 13px;
    color: var(--text-mid);
    line-height: 1.5;
  }

  .decision-check {
    font-size: 12px;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .decision-refs {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .decision-ref-link {
    font-family: var(--mono);
    font-size: 11px;
    color: rgba(80, 200, 220, 0.7);
    text-decoration: none;
  }

  .decision-ref-link:hover {
    color: rgba(80, 200, 220, 1);
    text-decoration: underline;
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

  .result-insight {
    margin: 0;
    font-size: 13px;
    color: var(--text-mid);
    font-style: italic;
    border-left: 2px solid var(--amber);
    padding-left: 10px;
  }

  .result-attribution {
    display: flex;
    gap: 16px;
    font-size: 11px;
    color: var(--text-dim);
    border-top: 1px solid var(--border);
    padding-top: 8px;
  }

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

  .filter-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 14px;
    background: rgba(245,166,35,0.08);
    border-bottom: 1px solid rgba(245,166,35,0.3);
    font-size: 12px;
    color: var(--text-muted, #888);
  }
  .filter-label { flex: 1; }

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
