import { z } from "zod";

// ── Crime categories ──────────────────────────────────────────────────────────

// Names taken from the Police API documentation; values are human‑readable descriptions.
export const CRIME_CATEGORIES = {
  "all-crime": "All crime",
  "anti-social-behaviour": "Anti-social behaviour",
  "bicycle-theft": "Bicycle theft",
  burglary: "Burglary",
  "criminal-damage-arson": "Criminal damage and arson",
  drugs: "Drugs",
  "other-theft": "Other theft",
  "possession-of-weapons": "Possession of weapons",
  "public-order": "Public order",
  robbery: "Robbery",
  shoplifting: "Shoplifting",
  "theft-from-the-person": "Theft from the person",
  "vehicle-crime": "Vehicle crime",
  "violent-crime": "Violent crime",
  "other-crime": "Other crime",
} as const;
export type CrimeCategory = keyof typeof CRIME_CATEGORIES;

// helper schema for runtime validation
export const CrimeCategorySchema = z.enum(
  Object.keys(CRIME_CATEGORIES) as [CrimeCategory, ...CrimeCategory[]],
);

// ── QueryPlanSchema ───────────────────────────────────────────────────────────

// TODO: define QueryPlanSchema — category, date_from (YYYY-MM), date_to (YYYY-MM), location (place name string)
export const QueryPlanSchema = z.object({
  category: CrimeCategorySchema,
  date_from: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM format"),
  date_to: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM format"),
  location: z.string(),
});
export type QueryPlan = z.infer<typeof QueryPlanSchema>;

// ── VizHint ───────────────────────────────────────────────────────────────────

// TODO: define VizHintSchema — enum of "map" | "bar" | "table"
// Note: viz_hint is NOT a field on QueryPlanSchema — it is derived deterministically after parsing
export const VizHintSchema = z.enum(["map", "bar", "table"]);
export type VizHint = z.infer<typeof VizHintSchema>;

// ── ParsedQuerySchema ─────────────────────────────────────────────────────────

// TODO: define ParsedQuerySchema — extends QueryPlanSchema, adds viz_hint, resolved_location, months[]
export const ParsedQuerySchema = QueryPlanSchema.extend({
  viz_hint: VizHintSchema,
  resolved_location: z.string(),
  months: z.array(z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM")),
});
export type ParsedQuery = z.infer<typeof ParsedQuerySchema>;

// ── IntentErrorSchema ─────────────────────────────────────────────────────────

// TODO: define IntentErrorSchema — error, understood (Partial<QueryPlan>), missing (string[]), message
// error variants: "incomplete_intent" | "invalid_intent" | "geocode_failed"
export const IntentErrorSchema = z.object({
  error: z.enum(["incomplete_intent", "invalid_intent", "geocode_failed"]),
  understood: QueryPlanSchema.partial(),
  missing: z.array(z.string()),
  message: z.string(),
});
export type IntentError = z.infer<typeof IntentErrorSchema>;

// ── Police API ────────────────────────────────────────────────────────────────

// TODO: define PoliceCrimeSchema with .passthrough() — known fields typed, unknown fields preserved
export const PoliceCrimeSchema = z
  .object({
    category: z.string().optional(),
    month: z.string().optional(),
    persistent_id: z.string().optional().nullable(),
    location_type: z.string().optional().nullable(),
    context: z.string().optional().nullable(),
    // more fields can be added as needed
  })
  .passthrough();
export type RawCrime = z.infer<typeof PoliceCrimeSchema>;

// ── CrimeResultSchema ─────────────────────────────────────────────────────────

// TODO: define CrimeResultSchema — all database fields including raw as z.unknown()
export const CrimeResultSchema = z
  .object({
    id: z.string().optional(),
    query_id: z.string().optional(),
    persistent_id: z.string().optional().nullable(),
    category: z.string().optional(),
    month: z.string().optional(),
    street: z.string().optional().nullable(),
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
    outcome_category: z.string().optional().nullable(),
    outcome_date: z.string().optional().nullable(),
    location_type: z.string().optional().nullable(),
    context: z.string().optional().nullable(),
    raw: z.unknown().optional(),
  })
  .passthrough();
export type CrimeResult = z.infer<typeof CrimeResultSchema>;

// ── NominatimResponseSchema ───────────────────────────────────────────────────

// TODO: define NominatimResponseSchema — array of hits each with boundingbox and display_name
export const NominatimResponseSchema = z.array(
  z.object({
    boundingbox: z.array(z.string()),
    display_name: z.string(),
    // other fields ignored
  }),
);
export type NominatimResponse = z.infer<typeof NominatimResponseSchema>;

// ── CoordinatesSchema ─────────────────────────────────────────────────────────

// TODO: define CoordinatesSchema — { lat: number, lon: number, display_name: string }
// Forward-compatibility: used by weather/traffic/events domains, not crime
export const CoordinatesSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  display_name: z.string(),
});
export type Coordinates = z.infer<typeof CoordinatesSchema>;

// ── PolygonSchema ─────────────────────────────────────────────────────────────

// TODO: define PolygonSchema — validates "lat,lng:lat,lng" format, max 100 points
export const PolygonSchema = z.string().refine((s) => {
  const pts = s.split(":");
  if (pts.length > 100) return false;
  return pts.every((p) => /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(p));
}, "must be lat,lng pairs separated by colon, max 100 points");
export type Polygon = z.infer<typeof PolygonSchema>;

// ── Schema evolution ──────────────────────────────────────────────────────────

// TODO: define PostgresColumnType — allowed values: text, integer, bigint, boolean, double precision, jsonb, timestamptz
export const PostgresColumnTypeSchema = z.enum([
  "text",
  "integer",
  "bigint",
  "boolean",
  "double precision",
  "jsonb",
  "timestamptz",
]);
export type PostgresColumnType = z.infer<typeof PostgresColumnTypeSchema>;

// TODO: define AddColumnSchema — op, table, column, type
export const AddColumnSchema = z.object({
  op: z.literal("ADD_COLUMN"),
  tableName: z.string(),
  columnName: z.string(),
  columnType: PostgresColumnTypeSchema,
});

// TODO: define SchemaOp type — { op: "USE_EXISTING" } | z.infer<typeof AddColumnSchema>
export type SchemaOp = { op: "USE_EXISTING" } | z.infer<typeof AddColumnSchema>;
