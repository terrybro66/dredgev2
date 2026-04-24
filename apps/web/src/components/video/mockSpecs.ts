/**
 * mockSpecs.ts — static VideoSpec fixtures for development.
 *
 * In production these will be replaced by a VideoSpec builder that translates
 * domain query results into scenes. The mock stubs cover the three domains that
 * already have play_video chips: food-business-gb, hunting-licence-gb, weather.
 *
 * resolveSpec() is the only public function — call it from the chip handler
 * with chip.args.intent and chip.args.domain.
 */
import type { VideoSpec } from "./types";

const SPECS: Record<string, VideoSpec> = {
  "hunting-licence-gb": {
    id: "hunting-licence-gb",
    title: "Getting a Hunting Licence in Great Britain",
    intent: "hunting licence",
    domain: "hunting-licence-gb",
    fps: 30,
    outputFormat: "player",
    totalFrames: 270,
    scenes: [
      {
        id: "s1",
        duration: 60,
        caption: "Hunting in Great Britain requires a valid licence from Natural England or NatureScot.",
        asset: {
          type: "image",
          url: "https://images.unsplash.com/photo-1501854140801-50d01698950b?w=1200&q=80",
          fit: "cover",
        },
      },
      {
        id: "s2",
        duration: 90,
        caption: "Step 1 — Check the species is covered by a general licence. Step 2 — Confirm you have landowner permission. Step 3 — Apply via gov.uk if a specific licence is required.",
        asset: {
          type: "text",
          heading: "Three steps to your licence",
          body: "1. Check species eligibility under general licences\n2. Obtain written landowner permission\n3. Apply at gov.uk/hunting if specific licence required",
        },
      },
      {
        id: "s3",
        duration: 60,
        caption: "General licences are free and cover most common species. Specific licences are issued case-by-case.",
        asset: {
          type: "chart",
          chartType: "bar",
          data: [
            { label: "General licence", value: 0 },
            { label: "Specific licence", value: 1 },
            { label: "Pest control", value: 0 },
          ],
        },
      },
      {
        id: "s4",
        duration: 60,
        caption: "Hunting zones are managed by Natural England, NatureScot and Natural Resources Wales.",
        asset: { type: "map", lat: 52.5, lon: -1.5, zoom: 6 },
      },
    ],
  },

  "food-business-gb": {
    id: "food-business-gb",
    title: "Registering a Food Business in Great Britain",
    intent: "food business registration",
    domain: "food-business-gb",
    fps: 30,
    outputFormat: "player",
    totalFrames: 240,
    scenes: [
      {
        id: "s1",
        duration: 60,
        caption: "All food businesses in Great Britain must register with their local authority before opening.",
        asset: {
          type: "image",
          url: "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1200&q=80",
          fit: "cover",
        },
      },
      {
        id: "s2",
        duration: 90,
        caption: "Step 1 — Register online at least 28 days before opening. Step 2 — Pass a food hygiene inspection. Step 3 — Display your food hygiene rating.",
        asset: {
          type: "text",
          heading: "Registration in three steps",
          body: "1. Register with your local council at least 28 days before opening\n2. Prepare for unannounced food hygiene inspection\n3. Display the food hygiene rating certificate visibly",
        },
      },
      {
        id: "s3",
        duration: 60,
        caption: "Food hygiene ratings run from 0 (urgent improvement required) to 5 (very good).",
        asset: {
          type: "chart",
          chartType: "bar",
          data: [
            { label: "Rating 5", value: 68 },
            { label: "Rating 4", value: 18 },
            { label: "Rating 3", value: 8 },
            { label: "Rating 2", value: 3 },
            { label: "Rating 1", value: 2 },
            { label: "Rating 0", value: 1 },
          ],
        },
      },
    ],
  },

  "weather": {
    id: "weather",
    title: "Reading the Weather Forecast",
    intent: "weather",
    domain: "weather",
    fps: 30,
    outputFormat: "player",
    totalFrames: 180,
    scenes: [
      {
        id: "s1",
        duration: 60,
        caption: "DREDGE weather data comes from Open-Meteo — a free, open-source weather API.",
        asset: {
          type: "image",
          url: "https://images.unsplash.com/photo-1504608524841-42584120d693?w=1200&q=80",
          fit: "cover",
        },
      },
      {
        id: "s2",
        duration: 60,
        caption: "Forecasts cover temperature, precipitation, and wind speed at hourly resolution for 7 days.",
        asset: {
          type: "chart",
          chartType: "line",
          data: [
            { label: "Mon", value: 12 },
            { label: "Tue", value: 14 },
            { label: "Wed", value: 15 },
            { label: "Thu", value: 10 },
            { label: "Fri", value: 9 },
            { label: "Sat", value: 11 },
            { label: "Sun", value: 13 },
          ],
        },
      },
      {
        id: "s3",
        duration: 60,
        caption: "Data is updated hourly. Source: Open-Meteo (open-meteo.com).",
        asset: { type: "map", lat: 51.505, lon: -0.09, zoom: 8 },
      },
    ],
  },
};

/**
 * Resolve a VideoSpec from chip args.
 * Falls back to domain key if intent key doesn't match exactly.
 */
export function resolveSpec(args: { intent?: string; domain?: string }): VideoSpec | null {
  const intentKey = (args.intent ?? "").toLowerCase().replace(/\s+/g, "-");
  const domainKey = args.domain ?? "";
  return SPECS[domainKey] ?? SPECS[intentKey] ?? null;
}
