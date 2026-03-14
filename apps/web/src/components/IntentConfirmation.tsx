interface Props {
  confirmation: {
    plan: {
      category: string;
      date_from: string;
      date_to: string;
      location: string;
    };
    viz_hint: "map" | "bar" | "table";
    resolved_location: string;
    country_code: string;
    intent: string;
    months: string[];
  };
  onConfirm: () => void;
  onRefine: () => void;
}

export function IntentConfirmation({
  confirmation,
  onConfirm,
  onRefine,
}: Props) {
  const { plan, viz_hint, resolved_location, months } = confirmation;
  const singleMonth = plan.date_from === plan.date_to;
  const monthsToFetch = months.length;

  const formatCategory = (category: string) => {
    return category
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const formatMonth = (dateStr: string) => {
    const date = new Date(dateStr + "-01");
    return date.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
  };

  const vizLabels = {
    map: "map",
    bar: "bar chart",
    table: "table",
  };

  return (
    <div className="intent-confirmation">
      <div className="confirmation-content">
        <p className="confirmation-text">
          <strong>Searching for</strong> {formatCategory(plan.category)}
          {" in "}
          <strong>{resolved_location}</strong>
          {" from "}
          {singleMonth ? (
            <strong>{formatMonth(plan.date_from)}</strong>
          ) : (
            <>
              <strong>{formatMonth(plan.date_from)}</strong>
              {" to "}
              <strong>{formatMonth(plan.date_to)}</strong>
            </>
          )}
          {" · visualized as "}
          <strong>{vizLabels[viz_hint]}</strong>
        </p>

        {monthsToFetch > 6 && (
          <div className="warning-banner">
            ⚠️ This will fetch {monthsToFetch} months of data and may take a
            moment
          </div>
        )}
      </div>

      <div className="confirmation-actions">
        <button className="btn-primary" onClick={onConfirm}>
          Search
        </button>
        <button className="btn-secondary" onClick={onRefine}>
          Refine
        </button>
      </div>
    </div>
  );
}
