import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { Provider } from "./types";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const TIMEOUT_MS = 10_000;

export interface RestProviderOptions {
  url: string;
  params?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function restGet<T>(options: RestProviderOptions): Promise<T> {
  const config: AxiosRequestConfig = {
    params: options.params,
    headers: options.headers,
    timeout: TIMEOUT_MS,
    responseType: "json",
  };

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response: AxiosResponse<T> = await axios.get(options.url, config);
      return response.data;
    } catch (err: any) {
      lastError = err;
      const status = err?.response?.status;
      if (status && status >= 400 && status < 500) throw err;
      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export interface CreateRestProviderOptions {
  url: string;
  params?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  extractRows?: (data: unknown) => unknown[];
}

export function createRestProvider(opts: CreateRestProviderOptions): Provider {
  return {
    fetchRows: async () => {
      const data = await restGet<unknown>({
        url: opts.url,
        params: opts.params,
        headers: opts.headers,
      });
      return opts.extractRows ? opts.extractRows(data) : (data as unknown[]);
    },
  };
}
