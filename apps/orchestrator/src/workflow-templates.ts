/**
 * workflow-templates.ts — Phase D.7
 *
 * Seed WorkflowTemplate definitions. Pure data — no I/O, no async.
 * The execution engine (D.8) reads these at runtime.
 *
 * Three templates:
 *   reachable-area        — isochrone from a starting point
 *   itinerary             — optimised multi-stop route
 *   cross-domain-overlay  — spatial join of two domain result sets
 */

import type { WorkflowTemplate } from "./types/connected";

// ── reachable-area ────────────────────────────────────────────────────────────

const reachableArea: WorkflowTemplate = {
  id: "reachable-area",
  name: "Reachable Area",
  description:
    "Given a starting point, transport mode, and time budget, compute the area reachable within that time.",

  trigger_intents: [
    "reachable area",
    "isochrone",
    "how far can i travel",
    "within 30 minutes",
    "travel time from",
    "accessible by",
  ],

  required_domains: ["transport"],

  input_schema: [
    {
      field: "origin",
      prompt: "Starting point (address or place name)",
      input_type: "text",
      required: true,
    },
    {
      field: "transport_mode",
      prompt: "How will you travel?",
      input_type: "select",
      options: ["walking", "cycling", "driving", "public_transport"],
      required: true,
    },
    {
      field: "time_budget_minutes",
      prompt: "Maximum travel time (minutes)",
      input_type: "number",
      required: true,
    },
  ],

  steps: [
    {
      id: "geocode-origin",
      domain: "geocoder",
      description: "Resolve the starting point to a lat/lon coordinate.",
      input_mappings: [
        { targetField: "location", source: "workflow_input", from: "origin" },
      ],
      output_key: "origin_coords",
    },
    {
      id: "compute-isochrone",
      domain: "transport",
      description:
        "Compute the reachable polygon for the given origin, mode, and time budget.",
      input_mappings: [
        {
          targetField: "lat",
          source: "step_output",
          from: "geocode-origin.lat",
        },
        {
          targetField: "lon",
          source: "step_output",
          from: "geocode-origin.lon",
        },
        {
          targetField: "transport_mode",
          source: "workflow_input",
          from: "transport_mode",
        },
        {
          targetField: "time_budget_minutes",
          source: "workflow_input",
          from: "time_budget_minutes",
        },
      ],
      output_key: "reachable_polygon",
    },
  ],
};

// ── itinerary ─────────────────────────────────────────────────────────────────

const itinerary: WorkflowTemplate = {
  id: "itinerary",
  name: "Day Out Itinerary",
  description:
    "Plan an optimised route visiting multiple points of interest, with travel times between each stop.",

  trigger_intents: [
    "itinerary",
    "day out",
    "plan a route",
    "visit multiple",
    "places to visit",
    "things to do in",
  ],

  required_domains: ["transport"],

  input_schema: [
    {
      field: "origin",
      prompt: "Where are you starting from?",
      input_type: "text",
      required: true,
    },
    {
      field: "destination_query",
      prompt:
        "What kind of places do you want to visit? (e.g. museums, parks, cinemas)",
      input_type: "text",
      required: true,
    },
    {
      field: "transport_mode",
      prompt: "How will you travel?",
      input_type: "select",
      options: ["walking", "cycling", "driving", "public_transport"],
      required: true,
    },
    {
      field: "date",
      prompt: "When is your day out? (YYYY-MM-DD)",
      input_type: "text",
      required: false,
    },
  ],

  steps: [
    {
      id: "geocode-origin",
      domain: "geocoder",
      description: "Resolve the starting point to a lat/lon coordinate.",
      input_mappings: [
        { targetField: "location", source: "workflow_input", from: "origin" },
      ],
      output_key: "origin_coords",
    },
    {
      id: "discover-pois",
      domain: "cinemas-gb", // will be generalised to a POI domain in D.10+
      description:
        "Find points of interest matching the destination query near the origin.",
      input_mappings: [
        {
          targetField: "lat",
          source: "step_output",
          from: "geocode-origin.lat",
        },
        {
          targetField: "lon",
          source: "step_output",
          from: "geocode-origin.lon",
        },
        {
          targetField: "query",
          source: "workflow_input",
          from: "destination_query",
        },
      ],
      output_key: "pois",
      optional: true,
    },
    {
      id: "optimise-route",
      domain: "transport",
      description:
        "Order the POIs to minimise total travel time (nearest-neighbour TSP).",
      input_mappings: [
        {
          targetField: "origin_lat",
          source: "step_output",
          from: "geocode-origin.lat",
        },
        {
          targetField: "origin_lon",
          source: "step_output",
          from: "geocode-origin.lon",
        },
        {
          targetField: "waypoints",
          source: "step_output",
          from: "discover-pois.rows",
        },
        {
          targetField: "transport_mode",
          source: "workflow_input",
          from: "transport_mode",
        },
      ],
      output_key: "ordered_route",
    },
    {
      id: "compute-travel-times",
      domain: "transport",
      description:
        "Compute travel time and distance between each consecutive stop.",
      input_mappings: [
        {
          targetField: "route",
          source: "step_output",
          from: "optimise-route.waypoints",
        },
        {
          targetField: "transport_mode",
          source: "workflow_input",
          from: "transport_mode",
        },
        { targetField: "date", source: "workflow_input", from: "date" },
      ],
      output_key: "travel_segments",
      optional: true,
    },
  ],
};

// ── cross-domain-overlay ──────────────────────────────────────────────────────

const crossDomainOverlay: WorkflowTemplate = {
  id: "cross-domain-overlay",
  name: "Cross-Domain Overlay",
  description:
    "Fetch results from two different domains for the same area and display them as a combined spatial overlay.",

  trigger_intents: [
    "overlay",
    "combine",
    "compare flood risk and crime",
    "flood risk and transport",
    "crime and transport",
    "show both",
    "cross domain",
  ],

  required_domains: [], // dynamic — uses whatever domains are registered

  input_schema: [
    {
      field: "location",
      prompt: "Which area?",
      input_type: "text",
      required: true,
    },
    {
      field: "domain_a",
      prompt: "First data layer",
      input_type: "select",
      options: ["crime-uk", "flood-risk", "weather", "cinemas-gb", "transport"],
      required: true,
    },
    {
      field: "domain_b",
      prompt: "Second data layer",
      input_type: "select",
      options: ["crime-uk", "flood-risk", "weather", "cinemas-gb", "transport"],
      required: true,
    },
  ],

  steps: [
    {
      id: "fetch-layer-a",
      domain: "{{domain_a}}", // D.8 executor substitutes from workflow_input
      description: "Fetch the first data layer for the target area.",
      input_mappings: [
        { targetField: "location", source: "workflow_input", from: "location" },
        { targetField: "domain", source: "workflow_input", from: "domain_a" },
      ],
      output_key: "layer_a",
    },
    {
      id: "fetch-layer-b",
      domain: "{{domain_b}}",
      description: "Fetch the second data layer for the same area.",
      input_mappings: [
        { targetField: "location", source: "workflow_input", from: "location" },
        { targetField: "domain", source: "workflow_input", from: "domain_b" },
      ],
      output_key: "layer_b",
    },
    {
      id: "spatial-join",
      domain: "overlay",
      description:
        "Spatially join layer_a and layer_b into a combined result set.",
      input_mappings: [
        {
          targetField: "handle_a",
          source: "step_output",
          from: "fetch-layer-a.handle_id",
        },
        {
          targetField: "handle_b",
          source: "step_output",
          from: "fetch-layer-b.handle_id",
        },
      ],
      output_key: "overlay_result",
    },
  ],
};

// ── hunting-day-plan ──────────────────────────────────────────────────────────

const huntingDayPlan: WorkflowTemplate = {
  id: "hunting-day-plan",
  name: "Hunting Day Planner",
  description:
    "Plan a full day's hunting trip — travel times from your location to open access zones, with a timed schedule.",

  trigger_intents: [
    "plan a day there",
    "plan a hunting day",
    "hunting day trip",
    "plan my hunt",
    "day out hunting",
  ],

  required_domains: ["geocoder", "hunting-zones-gb", "travel-estimator"],

  input_schema: [
    {
      field: "origin",
      prompt: "Where are you travelling from?",
      input_type: "text",
      required: true,
    },
    {
      field: "transport_mode",
      prompt: "How will you travel?",
      input_type: "select",
      options: ["walking", "cycling", "driving", "public_transport"],
      required: true,
    },
    {
      field: "game_species",
      prompt: "Which species?",
      input_type: "select",
      options: ["Deer", "Pheasant", "Grouse", "Duck", "Other"],
      required: false,
    },
  ],

  steps: [
    {
      id: "geocode-origin",
      domain: "geocoder",
      description: "Resolve starting point to lat/lon.",
      input_mappings: [
        { targetField: "location", source: "workflow_input", from: "origin" },
      ],
      output_key: "origin_coords",
    },
    {
      id: "fetch-zones",
      domain: "hunting-zones-gb",
      description: "Find open access land near the origin.",
      input_mappings: [
        {
          targetField: "lat",
          source: "step_output",
          from: "geocode-origin.lat",
        },
        {
          targetField: "lon",
          source: "step_output",
          from: "geocode-origin.lon",
        },
        { targetField: "location", source: "workflow_input", from: "origin" },
      ],
      output_key: "zones",
    },
    {
      id: "compute-travel-times",
      domain: "travel-estimator",
      description: "Compute travel time from origin to each zone.",
      input_mappings: [
        {
          targetField: "lat",
          source: "step_output",
          from: "geocode-origin.lat",
        },
        {
          targetField: "lon",
          source: "step_output",
          from: "geocode-origin.lon",
        },
        {
          targetField: "transport_mode",
          source: "workflow_input",
          from: "transport_mode",
        },
        { targetField: "waypoints", source: "step_output", from: "fetch-zones.rows" },
      ],
      output_key: "travel_times",
    },
  ],
};

// ── Registry ──────────────────────────────────────────────────────────────────

export const WORKFLOW_TEMPLATES: ReadonlyArray<WorkflowTemplate> = [
  reachableArea,
  itinerary,
  crossDomainOverlay,
  huntingDayPlan,
];

/**
 * Find a workflow by id.
 */
export function getWorkflowById(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((w) => w.id === id);
}

/**
 * Find workflows whose trigger_intents match the given free text.
 * Matching is substring, case-insensitive. Returns all matches sorted by
 * number of matching intents descending (most relevant first).
 */
export function findWorkflowsForIntent(text: string): WorkflowTemplate[] {
  const lower = text.toLowerCase();
  const scored = WORKFLOW_TEMPLATES.map((w) => ({
    template: w,
    matches: w.trigger_intents.filter((ti) => lower.includes(ti.toLowerCase()))
      .length,
  })).filter(({ matches }) => matches > 0);

  scored.sort((a, b) => b.matches - a.matches);
  return scored.map(({ template }) => template);
}
