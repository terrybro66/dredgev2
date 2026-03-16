import { z } from "zod";

// ── Crime categories ──────────────────────────────────────────────────────────

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

// Exported as an array so tests can assert membership
export const CrimeCategorySlugs = Object.keys(
  CRIME_CATEGORIES,
) as CrimeCategory[];

export const CrimeCategorySchema = z.enum(
  Object.keys(CRIME_CATEGORIES) as [CrimeCategory, ...CrimeCategory[]],
);

// Keep original name as alias so existing imports don't break
export { CrimeCategorySchema as CrimeCategory };

// ── QueryPlanSchema ───────────────────────────────────────────────────────────

// location must be a place name string — coordinates are never allowed here
const COORDINATE_PATTERN = /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/;

export const QueryPlanSchema = z.object({
  category: CrimeCategorySchema,
  date_from: z.string().regex(/^\d{4}-\d{2}$/, "must be YYYY-MM format"),
  date_to: z.string().regex(/^\d{4}-\d{2}$/, "must be YYYY-MM format"),
  location: z
    .string()
    .min(1)
    .refine((s) => !COORDINATE_PATTERN.test(s.trim()), {
      message: "location must be a place name, not coordinates",
    }),
});
export type QueryPlan = z.infer<typeof QueryPlanSchema>;

// ── VizHint ───────────────────────────────────────────────────────────────────

export const VizHintSchema = z.enum([
  "map",
  "bar",
  "table",
  "heatmap",
  "dashboard",
]);
export type VizHint = z.infer<typeof VizHintSchema>;

// ── ParsedQuerySchema ─────────────────────────────────────────────────────────

export const ParsedQuerySchema = QueryPlanSchema.extend({
  viz_hint: VizHintSchema,
  resolved_location: z.string().min(1),
  months: z
    .array(z.string().regex(/^\d{4}-\d{2}$/, "must be YYYY-MM format"))
    .min(1, "months must not be empty"),
});
export type ParsedQuery = z.infer<typeof ParsedQuerySchema>;

// ── IntentErrorSchema ─────────────────────────────────────────────────────────

export const IntentErrorSchema = z.object({
  error: z.enum(["incomplete_intent", "invalid_intent", "geocode_failed"]),
  understood: QueryPlanSchema.partial(),
  missing: z.array(z.string()),
  message: z.string(),
});
export type IntentError = z.infer<typeof IntentErrorSchema>;

// ── Police API ────────────────────────────────────────────────────────────────

export const PoliceCrimeSchema = z
  .object({
    category: z.string().optional(),
    month: z.string().optional(),
    persistent_id: z.string().optional().nullable(),
    location_type: z.string().optional().nullable(),
    location: z
      .object({
        latitude: z.string(),
        longitude: z.string(),
        street: z.object({ id: z.number(), name: z.string() }).optional(),
      })
      .optional(),
    context: z.string().optional().nullable(),
    outcome_status: z
      .object({ category: z.string(), date: z.string() })
      .nullable()
      .optional(),
    id: z.number().optional(),
    location_subtype: z.string().optional(),
  })
  .passthrough();
export type RawCrime = z.infer<typeof PoliceCrimeSchema>;

// ── CrimeResultSchema ─────────────────────────────────────────────────────────

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

// ── Domain source ─────────────────────────────────────────────────────────────

export const RefreshPolicySchema = z.enum([
  "realtime",
  "daily",
  "weekly",
  "static",
]);
export type RefreshPolicy = z.infer<typeof RefreshPolicySchema>;

export const DomainSourceSchema = z.object({
  type: z.enum(["rest", "csv", "xlsx", "pdf"]),
  url: z.string().url(),
  refreshPolicy: RefreshPolicySchema,
});
export type DomainSource = z.infer<typeof DomainSourceSchema>;

// ── Domain config ─────────────────────────────────────────────────────────────

export const LocationStyle = z.enum(["polygon", "coordinates"]);
export type LocationStyle = z.infer<typeof LocationStyle>;

export const DomainConfigSchema = z.object({
  sources: z.array(DomainSourceSchema).optional(),
  name: z.string().min(1),
  tableName: z.string().min(1),
  // camelCase Prisma model name e.g. "crimeResult" — used for prisma[model].findMany
  prismaModel: z.string().min(1),
  // ISO 3166-1 alpha-2 country codes. Empty array = match any country (intent-only routing)
  countries: z.array(z.string()),
  // intent keys this domain handles e.g. ["crime"], ["weather"]
  intents: z.array(z.string()).min(1, "intents must not be empty"),
  apiUrl: z.string().url(),
  apiKeyEnv: z.string().nullable(),
  locationStyle: LocationStyle,
  params: z.record(z.string()),
  flattenRow: z.record(z.string()),
  categoryMap: z.record(z.string()),
  vizHintRules: z.object({
    defaultHint: VizHintSchema,
    multiMonthHint: VizHintSchema,
  }),
  rateLimit: z
    .object({
      requestsPerMinute: z.number().int().positive(),
    })
    .optional(),
  cacheTtlHours: z.number().nonnegative().nullable().optional(),
});
export type DomainConfig = z.infer<typeof DomainConfigSchema>;

// ── Query cache  (new in v4.1) ────────────────────────────────────────────────

export const QueryCacheEntrySchema = z.object({
  id: z.string(),
  // SHA-256 of normalised { domain, category, date_from, date_to, resolved_location }
  query_hash: z.string().min(1),
  domain: z.string().min(1),
  result_count: z.number().int().nonnegative(),
  results: z.unknown(),
  createdAt: z.string().or(z.date()),
});
export type QueryCacheEntry = z.infer<typeof QueryCacheEntrySchema>;

// ── Geocoder cache  (new in v4.1) ─────────────────────────────────────────────

export const GeocoderCacheEntrySchema = z.object({
  id: z.string(),
  // normalised lowercase input — enforced so "Cambridge" and "cambridge" share one row
  place_name: z
    .string()
    .min(1)
    .refine((s) => s === s.toLowerCase(), {
      message: "place_name must be lowercase-normalised",
    }),
  display_name: z.string().min(1),
  lat: z.number(),
  lon: z.number(),
  country_code: z.string().min(2),
  // null until a polygon geocode has been performed for this place
  poly: z.string().nullable(),
  createdAt: z.string().or(z.date()),
});
export type GeocoderCacheEntry = z.infer<typeof GeocoderCacheEntrySchema>;

// ── Query job  (new in v4.1) ──────────────────────────────────────────────────

export const QueryJobSchema = z.object({
  id: z.string(),
  query_id: z.string(),
  status: z.enum(["pending", "complete", "error"]),
  domain: z.string().min(1),
  cache_hit: z.boolean(),
  rows_inserted: z.number().int().nonnegative(),
  parse_ms: z.number().int().nullable(),
  geocode_ms: z.number().int().nullable(),
  fetch_ms: z.number().int().nullable(),
  store_ms: z.number().int().nullable(),
  error_message: z.string().nullable(),
  createdAt: z.string().or(z.date()),
  completedAt: z.string().or(z.date()).nullable(),
});
export type QueryJob = z.infer<typeof QueryJobSchema>;

// ── Nominatim ─────────────────────────────────────────────────────────────────

export const NominatimResponseSchema = z.array(
  z.object({
    boundingbox: z.array(z.string()),
    display_name: z.string(),
    lat: z.string(),
    lon: z.string(),
    country_code: z.string(),
  }),
);
export type NominatimResponse = z.infer<typeof NominatimResponseSchema>;

// ── CoordinatesSchema ─────────────────────────────────────────────────────────

export const CoordinatesSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  display_name: z.string(),
  country_code: z.string(),
});
export type Coordinates = z.infer<typeof CoordinatesSchema>;

// ── PolygonSchema ─────────────────────────────────────────────────────────────

export const PolygonSchema = z
  .string()
  .min(1, "polygon must not be empty")
  .refine((s) => {
    const pts = s.split(":");
    if (pts.length > 100) return false;
    return pts.every((p) => /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(p));
  }, "must be lat,lng pairs separated by colon, max 100 points");
export type Polygon = z.infer<typeof PolygonSchema>;

// ── Schema evolution ──────────────────────────────────────────────────────────

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

// Column name regex: lowercase, starts with a letter, max 63 chars, no hyphens
const SAFE_COLUMN_NAME = /^[a-z][a-z0-9_]{0,62}$/;

export const AddColumnSchema = z.object({
  type: z.literal("add_column"),
  column: z
    .string()
    .regex(SAFE_COLUMN_NAME, "column name must match /^[a-z][a-z0-9_]{0,62}$/"),
  columnType: PostgresColumnTypeSchema,
});
export type AddColumn = z.infer<typeof AddColumnSchema>;

export type SchemaOp = { op: "USE_EXISTING" } | z.infer<typeof AddColumnSchema>;

// ── Re-export PostgresColumnType as value for tests that import it directly ───
export { PostgresColumnTypeSchema as PostgresColumnType };

// ── Follow-up chip  (new in v5.1) ─────────────────────────────────────────────

export const FollowUpSchema = z.object({
  label: z.string(),
  query: z.object({
    plan: QueryPlanSchema,
    poly: z.string(),
    viz_hint: VizHintSchema,
    resolved_location: z.string(),
    country_code: z.string(),
    intent: z.string(),
    months: z.array(z.string()),
  }),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;

// ── Fallback info  (new in v5.1) ──────────────────────────────────────────────

export const FallbackInfoSchema = z.object({
  field: z.enum(["date", "location", "category", "radius"]),
  original: z.string(),
  used: z.string(),
  explanation: z.string(),
});
export type FallbackInfo = z.infer<typeof FallbackInfoSchema>;

// ── Result context  (new in v5.1) ─────────────────────────────────────────────

export const ResultContextSchema = z.object({
  status: z.enum(["exact", "fallback", "empty"]),
  reason: z.string().optional(),
  fallback: FallbackInfoSchema.optional(),
  followUps: z.array(FollowUpSchema),
  confidence: z.enum(["high", "medium", "low"]),
});
export type ResultContext = z.infer<typeof ResultContextSchema>;

// ── Aggregated bin  (new in v6.0) ─────────────────────────────────────────────

export const AggregatedBinSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  count: z.number().int().positive(),
});
export type AggregatedBin = z.infer<typeof AggregatedBinSchema>;

// ── WeatherQueryPlan  (new in v6.0) ──────────────────────────────────────────

export const WeatherQueryPlanSchema = z.object({
  location: z
    .string()
    .min(1)
    .refine((s) => !/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(s.trim()), {
      message: "location must be a place name, not coordinates",
    }),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD format"),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD format"),
  metric: z.enum(["temperature", "precipitation", "wind"]).optional(),
});
export type WeatherQueryPlan = z.infer<typeof WeatherQueryPlanSchema>;
