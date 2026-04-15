import type { Provider, ProviderResult, ProviderSource } from "./types";
import { ProviderFetchError } from "./types";
import axios from "axios";

type PdfProviderOptions = {
  extractRows: (text: string) => Record<string, unknown>[];
};

export function createPdfProvider(options: PdfProviderOptions): Provider {
  return {
    async fetchData(source: ProviderSource): Promise<ProviderResult> {
      try {
        const response = await axios.get(source.url, {
          responseType: "arraybuffer",
        });
        const buffer = Buffer.from(response.data);
        // Lazy import — pdf-parse crashes at module load time in Node 18
        // due to DOMMatrix not being defined. Dynamic import defers it until
        // actually needed.
        const pdfParseModule = await import("pdf-parse");
        const pdfParse = (pdfParseModule as unknown as {
          default: (buffer: Buffer) => Promise<{ text: string }>;
        }).default;
        const parsed = await pdfParse(buffer);
        const rows = options.extractRows(parsed.text);

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
