import type { Provider, ProviderResult, ProviderSource } from "./types";
import { ProviderFetchError } from "./types";
import axios from "axios";
import * as XLSX from "xlsx";

export function createXlsxProvider(options?: { sheetName?: string }): Provider {
  return {
    async fetchData(source: ProviderSource): Promise<ProviderResult> {
      try {
        const response = await axios.get(source.url, {
          responseType: "arraybuffer",
        });
        const workbook = XLSX.read(response.data, { type: "buffer" });

        const sheetName = options?.sheetName ?? workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        const rows =
          XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

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
