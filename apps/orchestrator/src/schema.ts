import { PrismaClient } from "@prisma/client";
import { PostgresColumnType, AddColumnSchema, SchemaOp } from "@dredge/schemas";

export async function getCurrentColumns(
  prisma: PrismaClient,
  tableName: string,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = ${tableName}
    AND table_schema = 'public'
  `;
  return rows.map((r: { column_name: string }) => r.column_name);
}

export function findNewKeys(
  sampleRow: Record<string, unknown>,
  existingColumns: string[],
): string[] {
  return Object.keys(sampleRow).filter((key) => !existingColumns.includes(key));
}

export function inferPostgresType(value: unknown): PostgresColumnType {
  if (typeof value === "string") return "text";
  if (typeof value === "number")
    return Number.isInteger(value) ? "integer" : "double precision";
  if (typeof value === "boolean") return "boolean";
  if (value === null || value === undefined) return "text";
  if (typeof value === "object") return "jsonb";
  return "text";
}

export async function evolveSchema(
  prisma: PrismaClient,
  tableName: string,
  sampleRow: Record<string, unknown>,
  triggeredBy: string,
  domain: string,
): Promise<void> {
  const existingColumns = await getCurrentColumns(prisma, tableName);
  const newKeys = findNewKeys(sampleRow, existingColumns);

  if (newKeys.length === 0) return;

  for (const key of newKeys) {
    // Sanitise column name — replace invalid chars with _, ensure starts with letter
    const sanitisedKey = key
      .replace(/[^a-z0-9_]/gi, "_")
      .toLowerCase()
      .replace(/^[^a-z]+/, "c_")
      .slice(0, 63);

    if (!sanitisedKey || sanitisedKey === "_") continue;

    // Skip if the sanitised key already exists (raw key may differ from sanitised)
    if (existingColumns.includes(sanitisedKey)) continue;

    const columnType = inferPostgresType(sampleRow[key]);

    const op = AddColumnSchema.parse({
      type: "add_column",
      column: sanitisedKey,
      columnType,
    });
    await applySchemaOp(prisma, op, triggeredBy, tableName, domain);
  }
}

export async function applySchemaOp(
  prisma: PrismaClient,
  op: SchemaOp,
  triggeredBy: string,
  tableName: string,
  domain: string,
): Promise<void> {
  if (!("type" in op) || op.type !== "add_column") return;

  const { column, columnType } = op;

  const sql = `ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "${column}" ${columnType}`;

  const safePattern =
    /^ALTER TABLE "[a-z_][a-z0-9_]*" ADD COLUMN IF NOT EXISTS "[a-z][a-z0-9_]{0,62}" (text|integer|bigint|boolean|double precision|jsonb|timestamptz)$/;

  if (!safePattern.test(sql)) {
    throw new Error(`Unsafe or invalid SQL generated: ${sql}`);
  }

  await prisma.$executeRawUnsafe(sql);

  await (prisma as any).schemaVersion.create({
    data: {
      table_name: tableName,
      column_name: column,
      column_type: columnType,
      triggered_by: triggeredBy,
      domain,
    },
  });
}
