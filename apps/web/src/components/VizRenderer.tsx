import type { VizSpec } from "../types";
import { MapView } from "./MapView";
import { BarChart } from "./BarChart";
import { TableView } from "./TableView";
import { DashboardView } from "./DashboardView";

/**
 * VizRenderer — single switch point for all result visualisations.
 *
 * To add a new renderer:
 *   1. Add a variant to the VizSpec union in src/types.ts
 *   2. Create the component (e.g. src/components/TimelineView.tsx)
 *   3. Add one case here
 *   4. Optionally extend VizHint in types.ts if the backend should emit it
 *
 * Nothing else needs to change — StackCard, ResultRenderer, and StackedResultView
 * all route through here.
 */
export function VizRenderer({ spec }: { spec: VizSpec }) {
  switch (spec.type) {
    case "map":
      return <MapView rows={spec.rows} aggregated={spec.aggregated} />;

    case "bar":
      return <BarChart rows={spec.rows} months={spec.months} />;

    case "table":
      return (
        <TableView
          rows={spec.rows}
          activeFilter={spec.activeFilter}
          onClearFilter={spec.onClearFilter}
        />
      );

    case "dashboard":
      return <DashboardView rows={spec.rows} />;
  }
}
