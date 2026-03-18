import Papa from "papaparse";
import type { Provider, ProviderResult, ProviderSource } from "./types";
import { ProviderFetchError } from "./types";
import axios from "axios";

export function createCsvProvider(): Provider {
  return {
    async fetchData(source: ProviderSource): Promise<ProviderResult> {
      try {
        const response = await axios.get(source.url);
        const csv = response.data as string;

        if (!csv || csv.trim() === "") {
          return {
            rows: [],
            meta: {
              url: source.url,
              providerType: source.providerType,
              rowCount: 0,
              fetchedAt: new Date(),
            },
          };
        }

        const result = Papa.parse<Record<string, string>>(csv, {
          header: true,
          skipEmptyLines: true,
        });

        const rows = result.data;
        return {
          rows,
          meta: {
            url: source.url,
            providerType: source.providerType,
            rowCount: rows.length,
            fetchedAt: new Date(),
          },
        };
      } catch (err: unknown) {
        if (err instanceof ProviderFetchError) throw err;
        const status = (err as { response?: { status: number } })?.response
          ?.status;
        const message =
          (err as { message?: string })?.message ?? "Unknown error";
        throw new ProviderFetchError(message, source.url, status);
      }
    },
  };
}
