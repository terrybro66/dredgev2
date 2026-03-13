import { FollowUp, QueryPlan, VizHint } from "@dredge/schemas";

export interface FollowUpInput {
  domain: string;
  plan: QueryPlan;
  poly: string;
  viz_hint: VizHint;
  resolved_location: string;
  country_code: string;
  intent: string;
  months: string[];
  resultCount: number;
}

// ── Crime UK follow-up chips ──────────────────────────────────────────────────

function generateCrimeUkFollowUps(input: FollowUpInput): FollowUp[] {
  const {
    plan,
    poly,
    viz_hint,
    resolved_location,
    country_code,
    intent,
    months,
    resultCount,
  } = input;
  const chips: FollowUp[] = [];

  // Single month → offer last 6 months
  if (plan.date_from === plan.date_to) {
    const [year, month] = plan.date_from.split("-").map(Number);
    let fromMonth = month - 6;
    let fromYear = year;
    if (fromMonth <= 0) {
      fromMonth += 12;
      fromYear -= 1;
    }
    const date_from = `${fromYear}-${String(fromMonth).padStart(2, "0")}`;
    chips.push({
      label: "See last 6 months",
      query: {
        plan: { ...plan, date_from, date_to: plan.date_from },
        poly,
        viz_hint,
        resolved_location,
        country_code,
        intent,
        months,
      },
    });
  }

  // Specific category → offer all crime
  if (plan.category !== "all-crime") {
    chips.push({
      label: "All crime types",
      query: {
        plan: { ...plan, category: "all-crime" },
        poly,
        viz_hint,
        resolved_location,
        country_code,
        intent,
        months,
      },
    });
  }

  // Few results → widen search area
  if (resultCount < 10) {
    chips.push({
      label: "Widen search area",
      query: {
        plan,
        poly,
        viz_hint,
        resolved_location,
        country_code,
        intent,
        months,
      },
    });
  }

  return chips.slice(0, 4);
}

// ── Public entry point ────────────────────────────────────────────────────────

export function generateFollowUps(input: FollowUpInput): FollowUp[] {
  switch (input.domain) {
    case "crime-uk":
      return generateCrimeUkFollowUps(input);
    default:
      return [];
  }
}
