import type { VizHint, QueryRow, AggregatedBin } from "../types";
import { buildVizSpec } from "../types";
import { VizRenderer } from "./VizRenderer";

export interface StackEntry {
  query_id?: string;
  intent?: string;
  viz_hint: VizHint;
  results: QueryRow[] | AggregatedBin[];
  aggregated?: boolean;
  months_fetched?: string[];
}

interface ResultCardProps {
  entry: StackEntry;
  isLatest: boolean;
}

function ResultCard({ entry, isLatest }: ResultCardProps) {
  return (
    <div className={`result-card ${isLatest ? "latest" : ""}`}>
      {entry.intent && <h3 className="result-title">{entry.intent}</h3>}
      <VizRenderer
        spec={buildVizSpec(entry.viz_hint, entry.results, {
          aggregated: entry.aggregated ?? false,
          months: entry.months_fetched ?? [],
        })}
      />
    </div>
  );
}

export function StackedResultView({ stack }: { stack: StackEntry[] }) {
  return (
    <div className="result-stack">
      {stack.map((entry, i) => (
        <ResultCard
          key={entry.query_id ?? i}
          entry={entry}
          isLatest={i === stack.length - 1}
        />
      ))}
    </div>
  );
}
