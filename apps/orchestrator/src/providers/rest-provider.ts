import type { Provider, ProviderResult, ProviderSource } from "./types";
import { ProviderFetchError } from "./types";
import axios from "axios";

type RestProviderOptions = {
  extractRows: (data: unknown) => Record<string, unknown>[];
};

export function createRestProvider(options: RestProviderOptions): Provider {
  return {
    async fetchData(source: ProviderSource): Promise<ProviderResult> {
      try {
        const response = await axios.get(source.url);
        const rows = options.extractRows(response.data);
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
        const status = (err as { response?: { status: number } })?.response
          ?.status;
        const message =
          (err as { message?: string })?.message ?? "Unknown error";
        throw new ProviderFetchError(message, source.url, status);
      }
    },
  };
}
