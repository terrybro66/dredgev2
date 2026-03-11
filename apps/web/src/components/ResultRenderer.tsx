// TODO: implement ResultRenderer
// - summary line: count, category, date range, resolved location, months fetched
// - render map when viz_hint === "map"
// - render bar chart when viz_hint === "bar" — x-axis: month, y-axis: count
// - render table when viz_hint === "table"
//     table columns: category | street | month | outcome
//     cap table at 50 rows
// - validate response shape with Zod at this boundary
// - show Zod validation error in red if response shape is unexpected

interface Props {
  result: any; // TODO: type from @dredge/schemas
}

export function ResultRenderer({ result }: Props) {
  return <div>TODO: ResultRenderer</div>;
}
