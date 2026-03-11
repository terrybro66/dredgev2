// TODO: implement IntentConfirmation
// - render interpreted plan as human-readable summary:
//     Searching for CATEGORY in RESOLVED_LOCATION from DATE_FROM to DATE_TO — N months — visualised as VIZ_HINT
// - show "Search" button → calls onConfirm
// - show "Refine" button → calls onRefine
// - if date range spans more than 6 months, show warning:
//     "This will fetch N months of data and may take a moment"

interface Props {
  confirmation: any; // TODO: type as ParsedQuery from @dredge/schemas
  onConfirm: () => void;
  onRefine: () => void;
}

export function IntentConfirmation({ confirmation, onConfirm, onRefine }: Props) {
  return <div>TODO: IntentConfirmation</div>;
}
