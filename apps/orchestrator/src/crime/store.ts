import { PrismaClient } from "@dredge/database";
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
}
