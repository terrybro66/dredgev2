import axios, { AxiosRequestConfig, AxiosResponse } from "axios";

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
      console.log("RAW RESPONSE status:", response.status);
      console.log("RAW RESPONSE data type:", typeof response.data);
      console.log(
        "RAW RESPONSE data:",
        JSON.stringify(response.data).slice(0, 200),
      );
      return response.data;
    } catch (err: any) {
      lastError = err;

      // Only retry on 5xx or network errors — not 4xx
      const status = err?.response?.status;
      if (status && status >= 400 && status < 500) {
        throw err;
      }

      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(
          JSON.stringify({
            event: "rest_provider_retry",
            url: options.url,
            attempt: attempt + 1,
            delay_ms: delay,
            error: err?.message,
          }),
        );
        await sleep(delay);
      }
    }
  }

  throw lastError;
}
