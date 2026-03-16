import Papa from "papaparse";
import { Provider } from "./types";

export interface CreateCsvProviderOptions {
  content: string;
}

export function createCsvProvider(opts: CreateCsvProviderOptions): Provider {
  return {
    fetchRows: async () => {
      if (!opts.content.trim()) return [];
      const result = Papa.parse(opts.content, {
        header: true,
        skipEmptyLines: true,
      });
      return result.data as unknown[];
    },
  };
}
