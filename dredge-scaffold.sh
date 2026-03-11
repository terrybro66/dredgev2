#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# dredge — monorepo scaffold
# Creates the full directory structure and placeholder files.
# No logic is written — every source file exports a TODO stub.
# Run from the directory where you want the dredge folder created.
# Usage: bash scaffold.sh
# ─────────────────────────────────────────────────────────────────────────────

ROOT="dredge"

# ── Helpers ───────────────────────────────────────────────────────────────────

make_dir() {
  mkdir -p "$1"
  echo "  dir  $1"
}

write_file() {
  local path="$1"
  local content="$2"
  mkdir -p "$(dirname "$path")"
  printf '%s\n' "$content" > "$path"
  echo "  file $path"
}

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "scaffolding dredge monorepo..."
echo ""

# ── Root ──────────────────────────────────────────────────────────────────────

make_dir "$ROOT"

write_file "$ROOT/package.json" \
'{
  "name": "dredge",
  "private": true,
  "workspaces": [
    "packages/*",
    "apps/*"
  ],
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "db:migrate": "npm run db:migrate --workspace=packages/database",
    "db:generate": "npm run db:generate --workspace=packages/database",
    "db:studio": "npm run db:studio --workspace=packages/database"
  },
  "devDependencies": {
    "turbo": "latest"
  }
}'

write_file "$ROOT/turbo.json" \
'{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    }
  }
}'

write_file "$ROOT/.env.example" \
'DEEPSEEK_API_KEY=
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dredge
PORT=3001'

write_file "$ROOT/.gitignore" \
'node_modules
dist
.env
*.tsbuildinfo
coverage'

write_file "$ROOT/docker-compose.yml" \
'services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: dredge
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:'

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "packages/schemas..."

make_dir "$ROOT/packages/schemas/src"

write_file "$ROOT/packages/schemas/package.json" \
'{
  "name": "@dredge/schemas",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}'

write_file "$ROOT/packages/schemas/tsconfig.json" \
'{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "declaration": true,
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src"]
}'

write_file "$ROOT/packages/schemas/src/index.ts" \
'import { z } from "zod";

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
export type SchemaOp = { op: "USE_EXISTING" } | z.infer<typeof AddColumnSchema>;'

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "packages/database..."

make_dir "$ROOT/packages/database/prisma"

write_file "$ROOT/packages/database/package.json" \
'{
  "name": "@dredge/database",
  "version": "0.1.0",
  "main": "index.ts",
  "scripts": {
    "db:migrate": "prisma migrate dev --schema=prisma/schema.prisma",
    "db:generate": "prisma generate --schema=prisma/schema.prisma",
    "db:studio": "prisma studio --schema=prisma/schema.prisma"
  },
  "dependencies": {
    "@prisma/client": "^5.0.0"
  },
  "devDependencies": {
    "prisma": "^5.0.0"
  }
}'

write_file "$ROOT/packages/database/prisma/schema.prisma" \
'generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// TODO: define Query model
// Fields: id, text, category, date_from, date_to, poly, viz_hint, createdAt
// Fields: domain String @default("crime")
// Fields: resolved_location String?
// Relation: results CrimeResult[]

// TODO: define CrimeResult model
// Fields: id, query_id, persistent_id, category, month
// Fields: street, latitude (Float), longitude (Float)
// Fields: outcome_category, outcome_date
// Fields: location_type, context
// Fields: raw Json?
// Convention: every domain result table must have a raw Json? column

// TODO: define SchemaVersion model
// Fields: id, table_name, column_name, column_type, triggered_by, createdAt
// Fields: domain String @default("crime")'

write_file "$ROOT/packages/database/index.ts" \
'export { PrismaClient } from "@prisma/client";

// TODO: re-export any additional types needed across the monorepo'

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "apps/orchestrator..."

make_dir "$ROOT/apps/orchestrator/src/__tests__/crime"
make_dir "$ROOT/apps/orchestrator/src/crime"

write_file "$ROOT/apps/orchestrator/package.json" \
'{
  "name": "@dredge/orchestrator",
  "version": "0.1.0",
  "scripts": {
    "dev": "ts-node-dev --respawn src/index.ts",
    "build": "tsc",
    "test": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "dependencies": {
    "@dredge/database": "*",
    "@dredge/schemas": "*",
    "axios": "^1.6.0",
    "cors": "^2.8.5",
    "dotenv": "^16.0.0",
    "express": "^4.18.0",
    "openai": "^4.0.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.0",
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "@vitest/coverage-v8": "latest",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.0.0",
    "vitest": "latest"
  }
}'

write_file "$ROOT/apps/orchestrator/tsconfig.json" \
'{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}'

# ── src/index.ts ──────────────────────────────────────────────────────────────

write_file "$ROOT/apps/orchestrator/src/index.ts" \
'import "dotenv/config";
// TODO: no console.log of key material under any circumstances

import express from "express";
import cors from "cors";
// TODO: import { queryRouter } from "./query"; — uncomment when step 10 is complete

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

// TODO: app.use("/query", queryRouter); — uncomment when step 10 is complete

app.get("/health", (_req, res) => {
  // TODO: return { status: "ok", timestamp: new Date().toISOString() }
  res.json({ status: "TODO" });
});

app.listen(PORT, () => {
  console.log(`dredge orchestrator running on http://localhost:${PORT}`);
});'

# ── src/db.ts ─────────────────────────────────────────────────────────────────

write_file "$ROOT/apps/orchestrator/src/db.ts" \
'import { PrismaClient } from "@dredge/database";

// TODO: attach to globalThis to survive hot reloads in development
// TODO: export single prisma instance

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

// TODO: guard with NODE_ENV check before assigning to globalThis'

# ── src/geocoder.ts ───────────────────────────────────────────────────────────

write_file "$ROOT/apps/orchestrator/src/geocoder.ts" \
'import { NominatimResponseSchema, CoordinatesSchema, PolygonSchema } from "@dredge/schemas";

// TODO: implement geocodeToPolygon(location: string): Promise<{ poly: string, display_name: string }>
// - call https://nominatim.openstreetmap.org/search
// - params: { q: location, format: "json", limit: 1 }
// - set User-Agent: "dredge/1.0" header — Nominatim requires this
// - validate response with NominatimResponseSchema.parse()
// - throw structured IntentError { error: "geocode_failed", ... } if result array is empty
// - extract boundingbox: [south, north, west, east] — parse all values to numbers
// - convert to poly format: "north,west:north,east:south,east:south,west"
// - validate with PolygonSchema.parse() before returning
// - return { poly, display_name }

export async function geocodeToPolygon(
  _location: string
): Promise<{ poly: string; display_name: string }> {
  throw new Error("TODO: implement geocodeToPolygon");
}

// TODO: implement geocodeToCoordinates(location: string): Promise<{ lat: number, lon: number, display_name: string }>
// - same Nominatim call as geocodeToPolygon
// - extract lat, lon, display_name — parse lat/lon to numbers
// - validate with CoordinatesSchema.parse()
// Forward-compatibility: used by weather/traffic/events domains, not crime

export async function geocodeToCoordinates(
  _location: string
): Promise<{ lat: number; lon: number; display_name: string }> {
  throw new Error("TODO: implement geocodeToCoordinates");
}'

# ── src/schema.ts ─────────────────────────────────────────────────────────────

write_file "$ROOT/apps/orchestrator/src/schema.ts" \
'import { PrismaClient } from "@dredge/database";
import { PostgresColumnType, AddColumnSchema, SchemaOp } from "@dredge/schemas";

// TODO: implement getCurrentColumns(prisma, tableName: string): Promise<string[]>
// - query information_schema.columns for the given tableName
// - tableName is a parameter, never hardcoded — works for any domain table

export async function getCurrentColumns(
  _prisma: PrismaClient,
  _tableName: string
): Promise<string[]> {
  throw new Error("TODO: implement getCurrentColumns");
}

// TODO: implement findNewKeys(sampleRow: Record<string, unknown>, existingColumns: string[]): string[]
// - return keys in sampleRow that are not in existingColumns

export function findNewKeys(
  _sampleRow: Record<string, unknown>,
  _existingColumns: string[]
): string[] {
  throw new Error("TODO: implement findNewKeys");
}

// TODO: implement inferPostgresType(value: unknown): PostgresColumnType
// - string             → "text"
// - number (integer)   → "integer"
// - number (decimal)   → "double precision"
// - boolean            → "boolean"
// - object/array       → "jsonb"
// - null/undefined     → "text"  (safe default)

export function inferPostgresType(_value: unknown): PostgresColumnType {
  throw new Error("TODO: implement inferPostgresType");
}

// TODO: implement evolveSchema(prisma, tableName, sampleRow, triggeredBy, domain)
// - get current columns for the specified tableName
// - find new keys
// - if none → return immediately
// - loop over every new key: infer type, build op, call applySchemaOp

export async function evolveSchema(
  _prisma: PrismaClient,
  _tableName: string,
  _sampleRow: Record<string, unknown>,
  _triggeredBy: string,
  _domain: string
): Promise<void> {
  throw new Error("TODO: implement evolveSchema");
}

// TODO: implement applySchemaOp(prisma, op, triggeredBy, tableName, domain)
// - if USE_EXISTING → return
// - build SQL: ALTER TABLE "<tableName>" ADD COLUMN "<column>" <type>
// - validate against safe regex before executing:
//   /^ALTER TABLE "?[a-z_][a-z0-9_]*"? ADD COLUMN "?([a-z_][a-z0-9_]*)"? (text|integer|bigint|boolean|double precision|jsonb|timestamptz)$/i
// - execute with prisma.$executeRawUnsafe(sql)
// - write SchemaVersion audit record including domain field

export async function applySchemaOp(
  _prisma: PrismaClient,
  _op: SchemaOp,
  _triggeredBy: string,
  _tableName: string,
  _domain: string
): Promise<void> {
  throw new Error("TODO: implement applySchemaOp");
}'

# ── src/query.ts ──────────────────────────────────────────────────────────────

write_file "$ROOT/apps/orchestrator/src/query.ts" \
'import { Router, Request, Response } from "express";
import { z } from "zod";
import { QueryPlanSchema, VizHintSchema } from "@dredge/schemas";
import { prisma } from "./db";
import { geocodeToPolygon } from "./geocoder";
import { evolveSchema } from "./schema";
import { parseIntent, deriveVizHint, expandDateRange } from "./crime/intent";
import { fetchCrimes } from "./crime/fetcher";
import { storeResults } from "./crime/store";

export const queryRouter = Router();

// ── POST /parse ───────────────────────────────────────────────────────────────

// TODO: validate req.body with Zod — return 400 with Zod error details on failure
// TODO: call parseIntent(text) — on IntentError return 400 with full structured error payload:
//   { error: "incomplete_intent", understood: {...}, missing: [...], message: "..." }
// TODO: call geocodeToPolygon(plan.location) — on geocode failure return 400 with structured error
// TODO: derive viz_hint from deriveVizHint(plan, text)
// TODO: return confirmation payload — do NOT write to database:
//   { plan, poly, viz_hint, resolved_location, months }

queryRouter.post("/parse", async (req: Request, res: Response) => {
  res.status(501).json({ error: "TODO: implement POST /query/parse" });
});

// ── POST /execute ─────────────────────────────────────────────────────────────

// TODO: validate req.body against execute schema { plan, poly, viz_hint, resolved_location }
// TODO: create Query record in postgres with domain: "crime"
// TODO: call fetchCrimes(plan, poly) — expands date range, fetches all months sequentially
// TODO: if crimes returned → evolveSchema(prisma, "crime_results", sampleRow, queryRecord.id, "crime")
// TODO: do NOT call evolveSchema if crimes array is empty
// TODO: call storeResults(queryRecord.id, crimes, prisma)
// TODO: validate outbound response with Zod before sending
// TODO: return { query_id, plan, poly, viz_hint, resolved_location, count, months_fetched, results }
// TODO: cap results at 100

queryRouter.post("/execute", async (req: Request, res: Response) => {
  res.status(501).json({ error: "TODO: implement POST /query/execute" });
});

// ── GET /:id ──────────────────────────────────────────────────────────────────

// TODO: prisma.query.findUnique with include: { results: true }
// TODO: return 404 if not found

queryRouter.get("/:id", async (req: Request, res: Response) => {
  res.status(501).json({ error: "TODO: implement GET /query/:id" });
});'

# ── src/crime/intent.ts ───────────────────────────────────────────────────────

write_file "$ROOT/apps/orchestrator/src/crime/intent.ts" \
'import OpenAI from "openai";
import { QueryPlanSchema, QueryPlan, VizHint } from "@dredge/schemas";

// TODO: configure DeepSeek client
// const client = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: "https://api.deepseek.com" });

// TODO: implement buildSystemPrompt(): string
// Rules to enforce in the prompt:
// - return JSON only, no prose, no markdown fences
// - location must be a place name, never coordinates
// - default location to "Cambridge, UK" when none specified
// - default category to "all-crime" when intent is unclear
// - resolve date_from and date_to as explicit YYYY-MM values:
//     "last month"   → previous full calendar month for both
//     "last 3 months"→ date_from = 3 months ago, date_to = last full month
//     "last year"    → date_from = 12 months ago, date_to = last full month
//     "January 2024" → date_from: "2024-01", date_to: "2024-01"
//     no date        → default to last full month for both
// - do NOT include viz_hint in output — derived after parsing
// - list all valid category slugs with descriptions

// TODO: implement stripFences(text: string): string
// - remove ```json ... ``` wrappers from LLM output

export function stripFences(_text: string): string {
  throw new Error("TODO: implement stripFences");
}

// TODO: implement deriveVizHint(plan: QueryPlan, rawText: string): VizHint
// - if date_from !== date_to → return "bar"
// - if category === "all-crime" and range > 1 month → return "bar"
// - if rawText contains "list", "show me", "what are", "details", "table" → return "table"
// - default → return "map"

export function deriveVizHint(_plan: QueryPlan, _rawText: string): VizHint {
  throw new Error("TODO: implement deriveVizHint");
}

// TODO: implement expandDateRange(date_from: string, date_to: string): string[]
// - return ordered array of all YYYY-MM months between and including from/to
// - throw if date_to is earlier than date_from

export function expandDateRange(_dateFrom: string, _dateTo: string): string[] {
  throw new Error("TODO: implement expandDateRange");
}

// TODO: implement parseIntent(rawText: string): Promise<QueryPlan>
// - throw "Query text must not be empty" on blank input
// - call DeepSeek with system prompt + user message, max_tokens: 256
// - strip fences, parse JSON
// - validate with QueryPlanSchema.safeParse()
// - on failure: throw structured IntentError with understood/missing fields populated
// - on success: return validated plan

export async function parseIntent(_rawText: string): Promise<QueryPlan> {
  throw new Error("TODO: implement parseIntent");
}'

# ── src/crime/fetcher.ts ──────────────────────────────────────────────────────

write_file "$ROOT/apps/orchestrator/src/crime/fetcher.ts" \
'import { PoliceCrimeSchema, RawCrime, QueryPlan } from "@dredge/schemas";
import { expandDateRange } from "./intent";

const BASE_URL = "https://data.police.uk/api/crimes-street";

// TODO: implement fetchCrimesForMonth(plan, poly, month: string): Promise<RawCrime[]>
// - validate poly does not exceed 100 points before calling API
// - call BASE_URL/{plan.category} with params { date: month, poly }
// - validate response with z.array(PoliceCrimeSchema).parse()
// - PoliceCrimeSchema uses .passthrough() — unknown fields preserved
// - log a warning on validation errors but do not throw
// - return RawCrime[]

export async function fetchCrimesForMonth(
  _plan: QueryPlan,
  _poly: string,
  _month: string
): Promise<RawCrime[]> {
  throw new Error("TODO: implement fetchCrimesForMonth");
}

// TODO: implement fetchCrimes(plan, poly): Promise<RawCrime[]>
// - expand date range to months array using expandDateRange(plan.date_from, plan.date_to)
// - call fetchCrimesForMonth for each month SEQUENTIALLY — not in parallel
// - sequential note: parallel requests for large date ranges can fail against the Police API
// - merge and return all results as a single flat array

export async function fetchCrimes(
  _plan: QueryPlan,
  _poly: string
): Promise<RawCrime[]> {
  throw new Error("TODO: implement fetchCrimes");
}'

# ── src/crime/store.ts ────────────────────────────────────────────────────────

write_file "$ROOT/apps/orchestrator/src/crime/store.ts" \
'import { PrismaClient } from "@dredge/database";
import { CrimeResultSchema, RawCrime } from "@dredge/schemas";

// TODO: implement flattenCrime(crime: RawCrime): Record<string, unknown>
// - category, month from top level
// - street from crime.location.street.name
// - latitude as parseFloat(crime.location.latitude)
// - longitude as parseFloat(crime.location.longitude)
// - outcome_category from crime.outcome_status?.category ?? null
// - outcome_date from crime.outcome_status?.date ?? null
// - location_type, context from top level
// - raw: crime — full original object preserved as JSONB
// - spread any unknown top-level fields not in the known set

export function flattenCrime(_crime: RawCrime): Record<string, unknown> {
  throw new Error("TODO: implement flattenCrime");
}

// TODO: implement storeResults(queryId, crimes, prisma): Promise<void>
// - if empty array → return without calling prisma
// - query information_schema.columns to get current column set for crime_results
// - flatten each crime with flattenCrime
// - for each row, filter to only keys present in the current schema
// - validate each record with CrimeResultSchema.partial().safeParse() — log warnings, do not throw
// - batch insert with prisma.$transaction

export async function storeResults(
  _queryId: string,
  _crimes: RawCrime[],
  _prisma: PrismaClient
): Promise<void> {
  throw new Error("TODO: implement storeResults");
}'

# ── src/crime/index.ts ────────────────────────────────────────────────────────

write_file "$ROOT/apps/orchestrator/src/crime/index.ts" \
'export { parseIntent, deriveVizHint, expandDateRange } from "./intent";
export { fetchCrimes, fetchCrimesForMonth } from "./fetcher";
export { storeResults, flattenCrime } from "./store";'

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "apps/orchestrator tests..."

write_file "$ROOT/apps/orchestrator/src/__tests__/db.test.ts" \
'import { describe, it, expect, beforeEach, vi } from "vitest";

describe("db singleton", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("prisma instance is defined", async () => {
    // TODO: import ../db and assert prisma is defined
  });

  it("returns the same instance on multiple imports", async () => {
    // TODO: import ../db twice and assert instanceA === instanceB
  });
});'

write_file "$ROOT/apps/orchestrator/src/__tests__/index.test.ts" \
'import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";

describe("GET /health", () => {
  it("returns 200", async () => {
    // TODO: build app, GET /health, assert status 200
  });

  it("body contains status: ok", async () => {
    // TODO: assert res.body.status === "ok"
  });

  it("body contains a timestamp field", async () => {
    // TODO: assert res.body.timestamp is defined
  });

  it("timestamp is a valid ISO 8601 string", async () => {
    // TODO: assert new Date(res.body.timestamp).toISOString() === res.body.timestamp
  });
});'

write_file "$ROOT/apps/orchestrator/src/__tests__/geocoder.test.ts" \
'import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("axios");

describe("geocodeToPolygon", () => {
  it("calls Nominatim with correct q parameter", async () => {
    // TODO
  });

  it("calls Nominatim with format: json and limit: 1", async () => {
    // TODO
  });

  it("sets User-Agent: dredge/1.0 header", async () => {
    // TODO
  });

  it("returns { poly, display_name } object", async () => {
    // TODO
  });

  it("returned poly has exactly 4 points for a bounding box", async () => {
    // TODO
  });

  it("all coordinate values in poly are numeric", async () => {
    // TODO
  });

  it("north/south and east/west values are in correct positions", async () => {
    // TODO
  });

  it("throws structured IntentError when result array is empty", async () => {
    // TODO
  });
});

describe("geocodeToCoordinates", () => {
  it("returns valid { lat, lon, display_name } object", async () => {
    // TODO
  });

  it("lat and lon are numbers, not strings", async () => {
    // TODO
  });

  it("throws structured IntentError when result array is empty", async () => {
    // TODO
  });
});'

write_file "$ROOT/apps/orchestrator/src/__tests__/schema.test.ts" \
'import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  $queryRaw: vi.fn(),
  $executeRawUnsafe: vi.fn(),
  schemaVersion: { create: vi.fn() },
} as any;

describe("getCurrentColumns", () => {
  it("queries information_schema for the given table name", async () => {
    // TODO
  });
});

describe("inferPostgresType", () => {
  it('infers "text" for string values', () => { /* TODO */ });
  it('infers "integer" for whole number values', () => { /* TODO */ });
  it('infers "double precision" for decimal values', () => { /* TODO */ });
  it('infers "boolean" for boolean values', () => { /* TODO */ });
  it('infers "jsonb" for object values', () => { /* TODO */ });
  it('infers "jsonb" for array values', () => { /* TODO */ });
  it('infers "text" as safe default for null', () => { /* TODO */ });
});

describe("evolveSchema", () => {
  it("returns immediately when no new keys found — no SQL executed", async () => {
    // TODO
  });

  it("calls applySchemaOp once per new key", async () => {
    // TODO
  });

  it("writes a SchemaVersion record for each new column", async () => {
    // TODO
  });

  it("works for crime_results table", async () => { /* TODO */ });
  it("works for a different table name", async () => { /* TODO */ });
});

describe("applySchemaOp", () => {
  it("does nothing on USE_EXISTING", async () => { /* TODO */ });
  it("executes correct ALTER TABLE SQL", async () => { /* TODO */ });
  it("rejects SQL containing semicolons", async () => { /* TODO */ });
  it("rejects SQL containing DROP", async () => { /* TODO */ });
  it("writes SchemaVersion record including domain field", async () => { /* TODO */ });
});'

write_file "$ROOT/apps/orchestrator/src/__tests__/query.test.ts" \
'import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../crime/intent");
vi.mock("../crime/fetcher");
vi.mock("../crime/store");
vi.mock("../geocoder");
vi.mock("../schema");

describe("POST /query/parse", () => {
  it("returns 400 when text field is missing", async () => { /* TODO */ });
  it("returns 400 when text is an empty string", async () => { /* TODO */ });
  it("returns 400 with structured IntentError when parseIntent throws", async () => { /* TODO */ });
  it("structured error includes understood and missing fields", async () => { /* TODO */ });
  it("returns 400 with structured error when geocoder fails", async () => { /* TODO */ });
  it("returns confirmation payload with plan, poly, viz_hint, resolved_location, months", async () => { /* TODO */ });
  it("does not write to the database", async () => { /* TODO */ });
  it("does not call fetchCrimes", async () => { /* TODO */ });
  it("viz_hint is derived, not from LLM", async () => { /* TODO */ });
  it("resolved_location reflects geocoder display_name", async () => { /* TODO */ });
  it("months array is correctly expanded from date range", async () => { /* TODO */ });
});

describe("POST /query/execute", () => {
  it("returns 400 when body is missing required fields", async () => { /* TODO */ });
  it("creates Query record with domain: crime", async () => { /* TODO */ });
  it("stores resolved_location on Query record", async () => { /* TODO */ });
  it("calls fetchCrimes with the poly from the request body", async () => { /* TODO */ });
  it("calls evolveSchema with crime_results and crime when crimes returned", async () => { /* TODO */ });
  it("does not call evolveSchema when crimes array is empty", async () => { /* TODO */ });
  it("response includes query_id, plan, poly, viz_hint, resolved_location, count, months_fetched, results", async () => { /* TODO */ });
  it("caps results at 100 items", async () => { /* TODO */ });
  it("returns 500 when fetchCrimes throws", async () => { /* TODO */ });
  it("returns 500 when storeResults throws", async () => { /* TODO */ });
});

describe("GET /query/:id", () => {
  it("returns 404 for unknown id", async () => { /* TODO */ });
  it("returns query record with results included", async () => { /* TODO */ });
});'

# ── crime test files ──────────────────────────────────────────────────────────

write_file "$ROOT/apps/orchestrator/src/__tests__/crime/intent.test.ts" \
'import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => {
  function MockOpenAI() {
    return { chat: { completions: { create: mockCreate } } };
  }
  return { default: MockOpenAI };
});

describe("parseIntent", () => {
  it("returns a valid QueryPlan with category, date_from, date_to, location", async () => { /* TODO */ });
  it("viz_hint is NOT present on the returned plan", async () => { /* TODO */ });
  it("poly is NOT present on the returned plan", async () => { /* TODO */ });
  it("location is a place name, never a coordinate string", async () => { /* TODO */ });
  it("defaults category to all-crime when not mentioned", async () => { /* TODO */ });
  it('resolves "last month" to correct date_from and date_to', async () => { /* TODO */ });
  it('resolves "last 3 months" to correct date_from and date_to', async () => { /* TODO */ });
  it('resolves "last year" to 12-month range', async () => { /* TODO */ });
  it('resolves "January 2024" to identical date_from and date_to', async () => { /* TODO */ });
  it("defaults both date fields to last full month when no date mentioned", async () => { /* TODO */ });
  it('defaults location to "Cambridge, UK" when not specified', async () => { /* TODO */ });
  it("strips markdown fences before parsing JSON", async () => { /* TODO */ });
  it('throws structured IntentError with missing: ["location"] when location absent', async () => { /* TODO */ });
  it('throws structured IntentError with missing: ["category"] when category absent', async () => { /* TODO */ });
  it("understood fields appear even when other fields fail", async () => { /* TODO */ });
  it("throws on malformed JSON response from LLM", async () => { /* TODO */ });
  it('throws "Query text must not be empty" on blank input', async () => { /* TODO */ });
});

describe("deriveVizHint", () => {
  it('returns "map" for single-month single-location query', () => { /* TODO */ });
  it('returns "bar" when date_from !== date_to', () => { /* TODO */ });
  it('returns "bar" when category is all-crime and range > 1 month', () => { /* TODO */ });
  it('returns "table" when raw text contains "list"', () => { /* TODO */ });
  it('returns "table" when raw text contains "show me"', () => { /* TODO */ });
  it('returns "table" when raw text contains "details"', () => { /* TODO */ });
  it('returns "map" as default when no rule matches', () => { /* TODO */ });
});

describe("expandDateRange", () => {
  it("same month → returns array with one entry", () => { /* TODO */ });
  it("two adjacent months → returns both in order", () => { /* TODO */ });
  it("3-month range → returns all three months in ascending order", () => { /* TODO */ });
  it("12-month range → returns 12 entries", () => { /* TODO */ });
  it("date_to earlier than date_from → throws", () => { /* TODO */ });
});'

write_file "$ROOT/apps/orchestrator/src/__tests__/crime/fetcher.test.ts" \
'import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("axios");

describe("fetchCrimesForMonth", () => {
  it("calls correct URL with category slug", async () => { /* TODO */ });
  it("passes date param as the month argument", async () => { /* TODO */ });
  it("passes poly param correctly", async () => { /* TODO */ });
  it("returns array of RawCrime objects", async () => { /* TODO */ });
  it("unknown fields on crime objects are preserved", async () => { /* TODO */ });
  it("handles empty array response without throwing", async () => { /* TODO */ });
  it("throws when polygon exceeds 100 points", async () => { /* TODO */ });
});

describe("fetchCrimes", () => {
  it("calls API once for a single-month range", async () => { /* TODO */ });
  it("calls API three times for a 3-month range", async () => { /* TODO */ });
  it("calls API twelve times for a 12-month range", async () => { /* TODO */ });
  it("merges results from all months into a single array", async () => { /* TODO */ });
  it("calls months sequentially, not in parallel", async () => { /* TODO */ });
  it("returns combined results in month-ascending order", async () => { /* TODO */ });
});'

write_file "$ROOT/apps/orchestrator/src/__tests__/crime/store.test.ts" \
'import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dredge/database");

describe("storeResults", () => {
  it("calls prisma.$transaction with the correct number of create operations", async () => { /* TODO */ });
  it("latitude is stored as a float, not a string", async () => { /* TODO */ });
  it("longitude is stored as a float, not a string", async () => { /* TODO */ });
  it("raw field contains the full original crime object", async () => { /* TODO */ });
  it("only writes columns that currently exist in the schema", async () => { /* TODO */ });
  it("a column not in the schema is silently dropped", async () => { /* TODO */ });
  it("a new column added by schema evolution in the same request is written correctly", async () => { /* TODO */ });
  it("unknown top-level fields are included in the flattened row", async () => { /* TODO */ });
  it("does not call prisma.$transaction when crimes array is empty", async () => { /* TODO */ });
});'

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "apps/web..."

make_dir "$ROOT/apps/web/src/components"

write_file "$ROOT/apps/web/package.json" \
'{
  "name": "@dredge/web",
  "version": "0.1.0",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "@dredge/schemas": "*",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  }
}'

write_file "$ROOT/apps/web/src/App.tsx" \
'import { useState } from "react";
import { QueryInput } from "./components/QueryInput";
import { IntentConfirmation } from "./components/IntentConfirmation";
import { IntentError } from "./components/IntentError";
import { ResultRenderer } from "./components/ResultRenderer";

// TODO: implement App
// - useState for confirmation, result, loading, error
// - handleQuery(text) → POST /query/parse → on success set confirmation, on IntentError show error component
// - handleConfirm() → POST /query/execute with confirmed plan → set result
// - handleRefine() → clear confirmation, return user to input with text pre-populated
// - render QueryInput, IntentConfirmation (when confirmation set), ResultRenderer (when result set)

export default function App() {
  return (
    <div>
      <h1>dredge</h1>
      {/* TODO: render pipeline components */}
    </div>
  );
}'

write_file "$ROOT/apps/web/src/components/QueryInput.tsx" \
'// TODO: implement QueryInput
// - controlled input, pre-populated when user refines a previous query
// - submit on enter or button click
// - disable while loading
// - loading label: "Interpreting..." during parse, "Fetching data..." during execute

interface Props {
  onSubmit: (text: string) => void;
  initialValue?: string;
  loading?: boolean;
  loadingLabel?: string;
}

export function QueryInput({ onSubmit, initialValue = "", loading = false, loadingLabel = "Loading..." }: Props) {
  return <div>TODO: QueryInput</div>;
}'

write_file "$ROOT/apps/web/src/components/IntentConfirmation.tsx" \
'// TODO: implement IntentConfirmation
// - render interpreted plan as human-readable summary:
//     Searching for CATEGORY in RESOLVED_LOCATION from DATE_FROM to DATE_TO — N months — visualised as VIZ_HINT
// - show "Search" button → calls onConfirm
// - show "Refine" button → calls onRefine
// - if date range spans more than 6 months, show warning:
//     "This will fetch N months of data and may take a moment"

interface Props {
  confirmation: any; // TODO: type as ParsedQuery from @dredge/schemas
  onConfirm: () => void;
  onRefine: () => void;
}

export function IntentConfirmation({ confirmation, onConfirm, onRefine }: Props) {
  return <div>TODO: IntentConfirmation</div>;
}'

write_file "$ROOT/apps/web/src/components/IntentError.tsx" \
'// TODO: implement IntentError
// - show understood fields as green chips — "Got: burglary, January 2024"
// - show missing fields as amber chips — "Missing: location"
// - show message as plain text explanation
// - show "Try again" link that returns focus to the input

interface Props {
  error: any; // TODO: type as IntentError from @dredge/schemas
  onRetry: () => void;
}

export function IntentError({ error, onRetry }: Props) {
  return <div>TODO: IntentError</div>;
}'

write_file "$ROOT/apps/web/src/components/ResultRenderer.tsx" \
'// TODO: implement ResultRenderer
// - summary line: count, category, date range, resolved location, months fetched
// - render map when viz_hint === "map"
// - render bar chart when viz_hint === "bar" — x-axis: month, y-axis: count
// - render table when viz_hint === "table"
//     table columns: category | street | month | outcome
//     cap table at 50 rows
// - validate response shape with Zod at this boundary
// - show Zod validation error in red if response shape is unexpected

interface Props {
  result: any; // TODO: type from @dredge/schemas
}

export function ResultRenderer({ result }: Props) {
  return <div>TODO: ResultRenderer</div>;
}'

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "done."
echo ""
echo "next steps:"
echo "  cd $ROOT"
echo "  cp .env.example .env   # add your DEEPSEEK_API_KEY and DATABASE_URL"
echo "  npm install"
echo "  docker compose up -d"
echo "  git init && git add . && git commit -m 'chore: scaffold monorepo'"
echo ""
