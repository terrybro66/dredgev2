/**
 * apps/web/src/store.ts
 *
 * Global UI state via Zustand.
 *
 * Current responsibilities:
 *   - executeQuery  — callable from any component to re-run a query via /execute
 *
 * Add new actions here as the app grows rather than threading callbacks through props.
 */

import { create } from "zustand";

interface ExecuteBody {
  plan: {
    category: string;
    date_from: string;
    date_to: string;
    location: string;
  };
  poly: string;
  viz_hint: string;
  resolved_location: string;
  country_code: string;
  intent: string;
  months: string[];
}

interface DredgeStore {
  // Set by App on mount — components call this to trigger a follow-up execute
  executeQuery: ((body: ExecuteBody) => void) | null;
  setExecuteQuery: (fn: (body: ExecuteBody) => void) => void;
}

export const useDredgeStore = create<DredgeStore>((set) => ({
  executeQuery: null,
  setExecuteQuery: (fn) => set({ executeQuery: fn }),
}));
