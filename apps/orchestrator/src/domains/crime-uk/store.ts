import type { RawCrime } from "./fetcher";

export async function storeResults(
  queryId: string,
  crimes: RawCrime[],
  prisma: any,
): Promise<void> {
  if (crimes.length === 0) return;

  await prisma.queryResult.createMany({
    data: crimes.map((crime) => {
      const c = crime as any;
      return {
        query_id: queryId,
        domain_name: "crime-uk",
        source_tag: "police-api",
        lat: c.location?.latitude ? parseFloat(c.location.latitude) : null,
        lon: c.location?.longitude ? parseFloat(c.location.longitude) : null,
        category: c.category ?? null,
        location: c.location?.street?.name ?? null,
        date: c.month ? new Date(`${c.month}-01`) : null,
        extras: {
          outcome_category: c.outcome_status?.category ?? null,
          outcome_date: c.outcome_status?.date ?? null,
          location_type: c.location_type ?? null,
          context: c.context ?? null,
          persistent_id: c.persistent_id ?? null,
        },
        raw: crime,
      };
    }),
  });
}
