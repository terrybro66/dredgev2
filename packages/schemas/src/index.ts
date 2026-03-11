import { z } from "zod";

// ── Crime categories ──────────────────────────────────────────────────────────

// TODO: define CRIME_CATEGORIES record with slug → description entries
// TODO: define CrimeCategory type as keyof typeof CRIME_CATEGORIES

// ── QueryPlanSchema ───────────────────────────────────────────────────────────

// TODO: define QueryPlanSchema — category, date_from (YYYY-MM), date_to (YYYY-MM), location (place name string)
export const QueryPlanSchema = z.object({}).passthrough();
export type QueryPlan = z.infer<typeof QueryPlanSchema>;

// ── ParsedQuerySchema ─────────────────────────────────────────────────────────

// TODO: define ParsedQuerySchema — extends QueryPlanSchema, adds viz_hint, resolved_location, months[]
export const ParsedQuerySchema = z.object({}).passthrough();
export type ParsedQuery = z.infer<typeof ParsedQuerySchema>;

// ── VizHint ───────────────────────────────────────────────────────────────────

// TODO: define VizHintSchema — enum of "map" | "bar" | "table"
// Note: viz_hint is NOT a field on QueryPlanSchema — it is derived deterministically after parsing
export const VizHintSchema = z.enum(["map", "bar", "table"]);
export type VizHint = z.infer<typeof VizHintSchema>;

// ── IntentErrorSchema ─────────────────────────────────────────────────────────

// TODO: define IntentErrorSchema — error, understood (Partial<QueryPlan>), missing (string[]), message
// error variants: "incomplete_intent" | "invalid_intent" | "geocode_failed"
export const IntentErrorSchema = z.object({}).passthrough();
export type IntentError = z.infer<typeof IntentErrorSchema>;

// ── Police API ────────────────────────────────────────────────────────────────

// TODO: define PoliceCrimeSchema with .passthrough() — known fields typed, unknown fields preserved
export const PoliceCrimeSchema = z.object({}).passthrough();
export type RawCrime = z.infer<typeof PoliceCrimeSchema>;

// ── CrimeResultSchema ─────────────────────────────────────────────────────────

// TODO: define CrimeResultSchema — all database fields including raw as z.unknown()
export const CrimeResultSchema = z.object({}).passthrough();
export type CrimeResult = z.infer<typeof CrimeResultSchema>;

// ── NominatimResponseSchema ───────────────────────────────────────────────────

// TODO: define NominatimResponseSchema — array of hits each with boundingbox and display_name
export const NominatimResponseSchema = z.array(z.object({}).passthrough());
export type NominatimResponse = z.infer<typeof NominatimResponseSchema>;

// ── CoordinatesSchema ─────────────────────────────────────────────────────────

// TODO: define CoordinatesSchema — { lat: number, lon: number, display_name: string }
// Forward-compatibility: used by weather/traffic/events domains, not crime
export const CoordinatesSchema = z.object({}).passthrough();
export type Coordinates = z.infer<typeof CoordinatesSchema>;

// ── PolygonSchema ─────────────────────────────────────────────────────────────

// TODO: define PolygonSchema — validates "lat,lng:lat,lng" format, max 100 points
export const PolygonSchema = z.string();
export type Polygon = z.infer<typeof PolygonSchema>;

// ── Schema evolution ──────────────────────────────────────────────────────────

// TODO: define PostgresColumnType — allowed values: text, integer, bigint, boolean, double precision, jsonb, timestamptz
export type PostgresColumnType = string;

// TODO: define AddColumnSchema — op, table, column, type
export const AddColumnSchema = z.object({}).passthrough();

// TODO: define SchemaOp type — { op: "USE_EXISTING" } | z.infer<typeof AddColumnSchema>
export type SchemaOp = { op: "USE_EXISTING" } | z.infer<typeof AddColumnSchema>;
