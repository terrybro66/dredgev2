import { ProviderFetchError } from "./types";
import axios from "axios";

type RestProviderOptions = {
  url: string;
};

export function createRestProvider(options: RestProviderOptions) {
  return {
    async fetchRows(): Promise<Record<string, unknown>[]> {
      try {
        const response = await axios.get(options.url);
        const data = response.data;
        // Handle both array responses and wrapped { items: [] } responses
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.items)) return data.items;
        if (data && Array.isArray(data.results)) return data.results;
        if (data && Array.isArray(data.data)) return data.data;
        return [];
      } catch (err: unknown) {
        const status = (err as { response?: { status: number } })?.response
          ?.status;
        const message =
          (err as { message?: string })?.message ?? "Unknown error";
        throw new ProviderFetchError(message, options.url, status);
      }
    },
  };
}

// Legacy helper used by csv/xlsx/pdf providers
export async function restGet<T>({ url }: { url: string }): Promise<T> {
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    return response.data as T;
  } catch (err: unknown) {
    const status = (err as { response?: { status: number } })?.response?.status;
    const message = (err as { message?: string })?.message ?? "Unknown error";
    throw new ProviderFetchError(message, url, status);
  }
}
