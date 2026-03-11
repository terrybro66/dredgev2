import { PrismaClient } from "@dredge/database";
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
}
