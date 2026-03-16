import * as XLSX from "xlsx";
import { Provider } from "./types";

export interface CreateXlsxProviderOptions {
  buffer: Buffer;
  sheetIndex?: number;
}

export function createXlsxProvider(opts: CreateXlsxProviderOptions): Provider {
  return {
    fetchRows: async () => {
      const wb = XLSX.read(opts.buffer, { type: "buffer" });
      const sheetName = wb.SheetNames[opts.sheetIndex ?? 0];
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws);
      return rows as unknown[];
    },
  };
}
