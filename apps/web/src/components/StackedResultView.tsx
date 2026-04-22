import { ExecuteResult } from "../types";
import { MapView } from "./MapView";
import { TableView } from "./TableView";
import { BarChart } from "./BarChart";
import { DashboardView } from "./DashboardView";

interface ResultCardProps {
  result: ExecuteResult;
  isLatest: boolean;
}

function ResultCard({ result, isLatest }: ResultCardProps) {
  return (
    <div className={`result-card ${isLatest ? "latest" : ""}`}>
      <h3 className="result-title">{result.intent}</h3>
      {result.viz_hint === "map" && <MapView results={result.results} />}
      {result.viz_hint === "table" && <TableView results={result.results} />}
      {result.viz_hint === "bar" && <BarChart results={result.results} />}
      {result.viz_hint === "dashboard" && <DashboardView results={result.results} />}
    </div>
  );
}

export function StackedResultView({ stack }: { stack: ExecuteResult[] }) {
  return (
    <div className="result-stack">
      {stack.map((result, i) => (
        <ResultCard 
          key={result.query_id ?? i}
          result={result}
          isLatest={i === stack.length - 1}
        />
      ))}
    </div>
  );
}
import { ExecuteResult } from "../types";
import { MapView } from "./MapView";
import { TableView } from "./TableView";
import { BarChart } from "./BarChart";
import { DashboardView } from "./DashboardView";

interface ResultCardProps {
  result: ExecuteResult;
  isLatest: boolean;
}

function ResultCard({ result, isLatest }: ResultCardProps) {
  return (
    <div className={`result-card ${isLatest ? "latest" : ""}`}>
      <h3 className="result-title">{result.intent}</h3>
      {result.viz_hint === "map" && <MapView results={result.results} />}
      {result.viz_hint === "table" && <TableView results={result.results} />}
      {result.viz_hint === "bar" && <BarChart results={result.results} />}
      {result.viz_hint === "dashboard" && <DashboardView results={result.results} />}
    </div>
  );
}

export function StackedResultView({ stack }: { stack: ExecuteResult[] }) {
  return (
    <div className="result-stack">
      {stack.map((result, i) => (
        <ResultCard 
          key={result.query_id ?? i}
          result={result}
          isLatest={i === stack.length - 1}
        />
      ))}
    </div>
  );
}
