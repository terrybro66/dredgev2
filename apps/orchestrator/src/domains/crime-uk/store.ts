import { PrismaClient } from "@prisma/client";
import { CrimeResultSchema } from "@dredge/schemas";
import { RawCrime } from "./fetcher";
import { getCurrentColumns } from "../../schema";

const KNOWN_KEYS = new Set([
  "category",
  "month",
  "location",
  "outcome_status",
  "location_type",
  "context",
  "persistent_id",
  "id",
  "location_subtype",
]);

export function flattenCrime(crime: RawCrime): Record<string, unknown> {
  const c = crime as any;

  const unknown: Record<string, unknown> = {};
  for (const key of Object.keys(crime)) {
    if (!KNOWN_KEYS.has(key)) {
      unknown[key] = c[key];
    }
  }

  return {
    category: c.category,
    month: c.month,
    street: c.location?.street?.name ?? null,
    latitude: c.location?.latitude ? parseFloat(c.location.latitude) : null,
    longitude: c.location?.longitude ? parseFloat(c.location.longitude) : null,
    outcome_category: c.outcome_status?.category ?? null,
    outcome_date: c.outcome_status?.date ?? null,
    location_type: c.location_type ?? null,
    context: c.context ?? null,
    raw: crime,
    ...unknown,
  };
}

export async function storeResults(
  queryId: string,
  crimes: RawCrime[],
  prisma: PrismaClient,
): Promise<void> {
  if (crimes.length === 0) return;

  const existingColumns = await getCurrentColumns(prisma, "crime_results");
  const columnSet = new Set(existingColumns);

  const ops = crimes.map((crime) => {
    const flat = flattenCrime(crime);

    // filter to only keys present in current schema, always include query_id
    const data: Record<string, unknown> = { query_id: queryId };
    for (const [key, value] of Object.entries(flat)) {
      if (columnSet.has(key)) {
        data[key] = value;
      }
    }

    const validation = CrimeResultSchema.partial().safeParse(data);
    if (!validation.success) {
      console.warn("CrimeResult validation warning:", validation.error.errors);
    }

    return (prisma as any).crimeResult.create({ data });
  });

  await prisma.$transaction(ops);
}
