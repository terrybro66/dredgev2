/**
 * itinerary-assembler.ts — Phase E.3
 *
 * Pure function — no I/O. Takes workflow step results and produces a
 * timed hunting-day itinerary.
 *
 * Schedule logic:
 *   07:00  Depart origin
 *   07:00 + travel_time_minutes  Arrive at zone
 *   Arrive + 240 min  Hunting activity (4 h default)
 *   After activity + travel_time_minutes  Return home
 */

export interface ItineraryStop {
  time: string; // "HH:MM"
  activity: string;
  location: string;
  duration_minutes: number;
  notes?: string;
}

export interface Itinerary {
  workflow_id: string;
  title: string;
  origin: string;
  zone: string;
  transport_mode: string;
  stops: ItineraryStop[];
  total_travel_minutes: number;
  total_activity_minutes: number;
  feasible: boolean;
  infeasibility_reason?: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function addMinutes(timeStr: string, minutes: number): string {
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

const ACTIVITY_DURATION: Record<string, number> = {
  Deer: 300, // 5h — deer stalking is a long slow stalk
  Pheasant: 240, // 4h
  Grouse: 240,
  Duck: 180, // 3h — wildfowling often dawn-limited
  Other: 240,
};

const MAX_RETURN_HOUR = 21; // 21:00 latest return

export function assembleHuntingItinerary(opts: {
  origin: string;
  zoneName: string;
  zoneCounty: string;
  travelMinutes: number;
  distanceKm: number;
  transportMode: string;
  gameSpecies?: string;
  departureHour?: number;
}): Itinerary {
  const {
    origin,
    zoneName,
    zoneCounty,
    travelMinutes,
    distanceKm,
    transportMode,
    gameSpecies = "Other",
    departureHour = 7,
  } = opts;

  const activityMins = ACTIVITY_DURATION[gameSpecies] ?? 240;
  const departure = `${pad(departureHour)}:00`;
  const arrival = addMinutes(departure, travelMinutes);
  const huntEnd = addMinutes(arrival, activityMins);
  const returnHome = addMinutes(huntEnd, travelMinutes);

  const returnTotalMinutes =
    departureHour * 60 + travelMinutes + activityMins + travelMinutes;
  const feasible = returnTotalMinutes <= MAX_RETURN_HOUR * 60;

  const stops: ItineraryStop[] = [
    {
      time: departure,
      activity: "Depart",
      location: origin,
      duration_minutes: travelMinutes,
      notes: `${formatDuration(travelMinutes)} travel (${distanceKm} km by ${transportMode})`,
    },
    {
      time: arrival,
      activity: `${gameSpecies} hunting`,
      location: `${zoneName}${zoneCounty ? `, ${zoneCounty}` : ""}`,
      duration_minutes: activityMins,
      notes: `${formatDuration(activityMins)} activity window`,
    },
    {
      time: huntEnd,
      activity: "Return journey",
      location: origin,
      duration_minutes: travelMinutes,
      notes: `Estimated arrival home: ${returnHome}`,
    },
  ];

  return {
    workflow_id: "hunting-day-plan",
    title: `${gameSpecies} hunting day at ${zoneName}`,
    origin,
    zone: zoneName,
    transport_mode: transportMode,
    stops,
    total_travel_minutes: travelMinutes * 2,
    total_activity_minutes: activityMins,
    feasible,
    infeasibility_reason: feasible
      ? undefined
      : `Return time ${returnHome} is after ${MAX_RETURN_HOUR}:00 — consider a closer zone or earlier departure`,
  };
}
