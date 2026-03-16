import * as pdfParseModule from "pdf-parse";
import { Provider } from "./types";

const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;

export interface CreatePdfProviderOptions {
  buffer: Buffer;
  extractRows: (text: string) => unknown[];
}

export function createPdfProvider(opts: CreatePdfProviderOptions): Provider {
  return {
    fetchRows: async () => {
      const result = await pdfParse(opts.buffer);
      return opts.extractRows(result.text);
    },
  };
}
