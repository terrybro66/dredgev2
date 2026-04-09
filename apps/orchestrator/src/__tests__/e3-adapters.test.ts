/**
 * e3-adapters.test.ts — Phase E.3
 *
 * Tests for:
 *   - travelEstimatorAdapter — Haversine travel times
 *   - assembleHuntingItinerary — schedule assembly
 *   - hunting-day-plan workflow template exists with correct shape
 */

import { describe, it, expect } from "vitest";

// ── travel-estimator ──────────────────────────────────────────────────────────

import { travelEstimatorAdapter } from "../domains/travel-estimator/index";

const LONDON = { lat: 51.5074, lon: -0.1278 };
const DARTMOOR = {
  lat: 50.5762,
  lon: -3.9221,
  description: "Dartmoor National Park",
  name: "Dartmoor",
};
const KIELDER = {
  lat: 55.2271,
  lon: -2.5468,
  description: "Kielder Forest",
  name: "Kielder",
};

describe("travelEstimatorAdapter", () => {
  it("returns empty array when no waypoints", async () => {
    const rows = await travelEstimatorAdapter.fetchData(
      {
        lat: LONDON.lat,
        lon: LONDON.lon,
        transport_mode: "driving",
        waypoints: [],
      },
      "",
    );
    expect(rows).toHaveLength(0);
  });

  it("returns empty array when origin is 0,0", async () => {
    const rows = await travelEstimatorAdapter.fetchData(
      { lat: 0, lon: 0, transport_mode: "driving", waypoints: [DARTMOOR] },
      "",
    );
    expect(rows).toHaveLength(0);
  });

  it("returns one row per waypoint", async () => {
    const rows = await travelEstimatorAdapter.fetchData(
      {
        lat: LONDON.lat,
        lon: LONDON.lon,
        transport_mode: "driving",
        waypoints: [DARTMOOR, KIELDER],
      },
      "",
    );
    expect(rows).toHaveLength(2);
  });

  it("row has name, distance_km, travel_time_minutes, transport_mode", async () => {
    const rows = await travelEstimatorAdapter.fetchData(
      {
        lat: LONDON.lat,
        lon: LONDON.lon,
        transport_mode: "driving",
        waypoints: [DARTMOOR],
      },
      "",
    );
    const row = rows[0] as Record<string, unknown>;
    expect(row.name).toBe("Dartmoor National Park");
    expect(typeof row.distance_km).toBe("number");
    expect(typeof row.travel_time_minutes).toBe("number");
    expect(row.transport_mode).toBe("driving");
  });

  it("Dartmoor is ~280 km from London by road (within 50 km tolerance)", async () => {
    const rows = await travelEstimatorAdapter.fetchData(
      {
        lat: LONDON.lat,
        lon: LONDON.lon,
        transport_mode: "driving",
        waypoints: [DARTMOOR],
      },
      "",
    );
    const row = rows[0] as Record<string, unknown>;
    // Haversine straight-line is ~260 km; road is longer but we're using straight-line
    expect(row.distance_km as number).toBeGreaterThan(230);
    expect(row.distance_km as number).toBeLessThan(320);
  });

  it("walking is slower than driving — same distance, more minutes", async () => {
    const [driving] = (await travelEstimatorAdapter.fetchData(
      {
        lat: LONDON.lat,
        lon: LONDON.lon,
        transport_mode: "driving",
        waypoints: [DARTMOOR],
      },
      "",
    )) as Record<string, unknown>[];
    const [walking] = (await travelEstimatorAdapter.fetchData(
      {
        lat: LONDON.lat,
        lon: LONDON.lon,
        transport_mode: "walking",
        waypoints: [DARTMOOR],
      },
      "",
    )) as Record<string, unknown>[];
    expect(walking.travel_time_minutes as number).toBeGreaterThan(
      driving.travel_time_minutes as number,
    );
    expect(driving.distance_km).toBeCloseTo(walking.distance_km as number, 0);
  });

  it("filters by time_budget_minutes", async () => {
    // Dartmoor is ~220 min by driving, Kielder is much further
    const rows = await travelEstimatorAdapter.fetchData(
      {
        lat: LONDON.lat,
        lon: LONDON.lon,
        transport_mode: "driving",
        waypoints: [DARTMOOR, KIELDER],
        time_budget_minutes: 250,
      },
      "",
    );
    // At ~70km/h Dartmoor is ~260/70*60 ≈ 222 min, Kielder is ~450/70*60 ≈ 385 min
    // Only Dartmoor should pass the 250 min budget
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.name).toBe("Dartmoor National Park");
  });

  it("results are sorted by travel_time_minutes ascending", async () => {
    const rows = (await travelEstimatorAdapter.fetchData(
      {
        lat: LONDON.lat,
        lon: LONDON.lon,
        transport_mode: "driving",
        waypoints: [KIELDER, DARTMOOR],
      },
      "",
    )) as Record<string, unknown>[];
    expect(rows[0].travel_time_minutes as number).toBeLessThanOrEqual(
      rows[1].travel_time_minutes as number,
    );
  });
});

// ── itinerary-assembler ───────────────────────────────────────────────────────

import { assembleHuntingItinerary } from "../itinerary-assembler";

describe("assembleHuntingItinerary", () => {
  const base = {
    origin: "London",
    zoneName: "Dartmoor National Park",
    zoneCounty: "Devon",
    travelMinutes: 222,
    distanceKm: 260,
    transportMode: "driving",
  };

  it("returns an itinerary with 3 stops", () => {
    const it = assembleHuntingItinerary(base);
    expect(it.stops).toHaveLength(3);
  });

  it("first stop is Depart at 07:00", () => {
    const it = assembleHuntingItinerary(base);
    expect(it.stops[0].time).toBe("07:00");
    expect(it.stops[0].activity).toBe("Depart");
  });

  it("second stop arrival time = departure + travel time", () => {
    const it = assembleHuntingItinerary(base);
    // 07:00 + 222 min = 10:42
    expect(it.stops[1].time).toBe("10:42");
  });

  it("total_travel_minutes is 2 × one-way travel", () => {
    const it = assembleHuntingItinerary(base);
    expect(it.total_travel_minutes).toBe(444);
  });

  it("Deer gets 300 min activity duration", () => {
    const it = assembleHuntingItinerary({ ...base, gameSpecies: "Deer" });
    expect(it.total_activity_minutes).toBe(300);
  });

  it("Duck gets 180 min activity duration", () => {
    const it = assembleHuntingItinerary({ ...base, gameSpecies: "Duck" });
    expect(it.total_activity_minutes).toBe(180);
  });

  it("title includes species and zone name", () => {
    const it = assembleHuntingItinerary({ ...base, gameSpecies: "Grouse" });
    expect(it.title).toContain("Grouse");
    expect(it.title).toContain("Dartmoor");
  });

  it("feasible is false when return time exceeds 21:00", () => {
    // 222 min travel + 300 min activity + 222 min return = 744 min from 07:00 = 19:24 — feasible
    // Use very long travel to make infeasible
    const it = assembleHuntingItinerary({
      ...base,
      travelMinutes: 600,
      gameSpecies: "Deer",
    });
    expect(it.feasible).toBe(false);
    expect(it.infeasibility_reason).toBeDefined();
  });

  it("feasible is true for a realistic day trip", () => {
    const it = assembleHuntingItinerary({
      ...base,
      travelMinutes: 120,
      gameSpecies: "Pheasant",
    });
    expect(it.feasible).toBe(true);
  });
});

// ── hunting-day-plan workflow template ────────────────────────────────────────

import { getWorkflowById, findWorkflowsForIntent } from "../workflow-templates";

describe("hunting-day-plan workflow template", () => {
  it("exists in registry", () => {
    expect(getWorkflowById("hunting-day-plan")).toBeDefined();
  });

  it("has three steps: geocode-origin, fetch-zones, compute-travel-times", () => {
    const t = getWorkflowById("hunting-day-plan")!;
    const ids = t.steps.map((s) => s.id);
    expect(ids).toContain("geocode-origin");
    expect(ids).toContain("fetch-zones");
    expect(ids).toContain("compute-travel-times");
  });

  it("requires geocoder, hunting-zones-gb, travel-estimator domains", () => {
    const t = getWorkflowById("hunting-day-plan")!;
    expect(t.required_domains).toContain("geocoder");
    expect(t.required_domains).toContain("hunting-zones-gb");
    expect(t.required_domains).toContain("travel-estimator");
  });

  it("matches 'plan a day there' intent", () => {
    const matches = findWorkflowsForIntent("plan a day there");
    expect(matches[0]?.id).toBe("hunting-day-plan");
  });

  it("input_schema has origin and transport_mode as required", () => {
    const t = getWorkflowById("hunting-day-plan")!;
    const required = t.input_schema
      .filter((f) => f.required)
      .map((f) => f.field);
    expect(required).toContain("origin");
    expect(required).toContain("transport_mode");
  });
});
