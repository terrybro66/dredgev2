import { getLatestMonth } from "./availability";

export interface ResolvedDateRange {
  date_from: string;
  date_to: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const MONTH_NAMES: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

const YYYY_MM = /^\d{4}-\d{2}$/;
const NAMED_MONTH = /^([a-z]+)\s+(\d{4})$/i;
const LAST_N_MONTHS = /^last\s+(\d+)\s+months?$/i;

function lastCalendarMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Subtract n months from a YYYY-MM string, handling year boundaries. */
function subtractMonths(yyyyMm: string, n: number): string {
  const [year, month] = yyyyMm.split("-").map(Number);
  const total = year * 12 + (month - 1) - n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function isAbsolute(temporal: string): boolean {
  const t = temporal.trim().toLowerCase();
  return (
    YYYY_MM.test(t) ||
    NAMED_MONTH.test(t) ||
    (t !== "unspecified" && !t.startsWith("last"))
  );
}

// ── defaultResolveTemporalRange ───────────────────────────────────────────────

export function defaultResolveTemporalRange(
  temporal: string,
): ResolvedDateRange {
  const t = temporal.trim().toLowerCase();

  // YYYY-MM passthrough
  if (YYYY_MM.test(t)) {
    return { date_from: t, date_to: t };
  }

  // Named month — "January 2026"
  const namedMatch = t.match(NAMED_MONTH);
  if (namedMatch) {
    const monthNum = MONTH_NAMES[namedMatch[1].toLowerCase()];
    if (monthNum) {
      const yyyyMm = `${namedMatch[2]}-${monthNum}`;
      return { date_from: yyyyMm, date_to: yyyyMm };
    }
  }

  // "last N months"
  const lastNMatch = t.match(LAST_N_MONTHS);
  if (lastNMatch) {
    const n = parseInt(lastNMatch[1], 10);
    const to = lastCalendarMonth();
    const from = subtractMonths(to, n - 1);
    return { date_from: from, date_to: to };
  }

  // "last year"
  if (t === "last year") {
    const to = lastCalendarMonth();
    const from = subtractMonths(to, 11);
    return { date_from: from, date_to: to };
  }

  // "last month" / "unspecified" / anything unrecognised
  const lm = lastCalendarMonth();
  return { date_from: lm, date_to: lm };
}

// ── resolveTemporalRangeForCrime ──────────────────────────────────────────────

export async function resolveTemporalRangeForCrime(
  temporal: string,
): Promise<ResolvedDateRange> {
  const t = temporal.trim().toLowerCase();

  // Absolute expressions bypass the cache entirely
  if (YYYY_MM.test(t) || NAMED_MONTH.test(t)) {
    return defaultResolveTemporalRange(temporal);
  }

  // Relative expressions — anchor to the availability cache
  const latest = await getLatestMonth("police-uk");

  if (!latest) {
    return defaultResolveTemporalRange(temporal);
  }

  // "last N months" — date_to = latest, date_from = N-1 months before latest
  const lastNMatch = t.match(LAST_N_MONTHS);
  if (lastNMatch) {
    const n = parseInt(lastNMatch[1], 10);
    const from = subtractMonths(latest, n - 1);
    return { date_from: from, date_to: latest };
  }

  // "last year" — 12 months ending at latest
  if (t === "last year") {
    const from = subtractMonths(latest, 11);
    return { date_from: from, date_to: latest };
  }

  // "last month" / "unspecified" / anything else — use latest month
  return { date_from: latest, date_to: latest };
}
