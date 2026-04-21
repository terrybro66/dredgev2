import axios from "axios";
import type { DomainConfigV2, FallbackInfo } from "@dredge/schemas";
import type { DomainAdapter } from "../registry";

// WMO weather interpretation codes → human-readable description
const WMO_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Icy fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  80: "Slight showers",
  81: "Moderate showers",
  82: "Violent showers",
  95: "Thunderstorm",
  99: "Thunderstorm with hail",
};

function describeCode(code: number): string {
  return WMO_CODES[code] ?? "Unknown";
}

interface GeoResult {
  latitude: number;
  longitude: number;
  name: string;
}

interface OpenMeteoDaily {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
  wind_speed_10m_max: number[];
  weathercode: number[];
}

interface OpenMeteoResponse {
  daily: OpenMeteoDaily;
}

async function geocodeLocation(location: string): Promise<GeoResult> {
  // Strip temporal phrases the LLM sometimes leaks into the location field
  const cleaned = location
    .replace(
      /\b(in|for|during)\s+(january|february|march|april|may|june|july|august|september|october|november|december|\d{4})\b/gi,
      "",
    )
    .replace(/\b(last|next|this)\s+(week|month|year)\b/gi, "")
    .replace(
      /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(day|week|month|year)s?\s+ago\b/gi,
      "",
    )
    .replace(/\b(yesterday|today|tomorrow|recently|currently|now)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const cityName = (cleaned || location).split(",")[0].trim();
  const response = await axios.get<{ results?: GeoResult[] }>(
    "https://geocoding-api.open-meteo.com/v1/search",
    { params: { name: cityName, count: 1, language: "en", format: "json" } },
  );

  const results = response.data.results;
  if (!results || results.length === 0) {
    throw new Error(`Could not geocode location: ${location}`);
  }

  return results[0];
}

async function fetchWeatherForDates(
  lat: number,
  lon: number,
  dateFrom: string,
  dateTo: string,
): Promise<OpenMeteoResponse> {
  const today = new Date().toISOString().slice(0, 10);

  // Forecast API covers ~92 days in the past; archive has a multi-week lag.
  // Use forecast for anything within the last 90 days to avoid the archive gap.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const endpoint =
    dateFrom < ninetyDaysAgo
      ? "https://archive-api.open-meteo.com/v1/archive"
      : "https://api.open-meteo.com/v1/forecast";

  // Forecast API only covers ~16 days ahead — clamp end date
  const maxForecast = new Date(Date.now() + 15 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const effectiveDateTo =
    endpoint.includes("forecast") && dateTo > maxForecast
      ? maxForecast
      : dateTo;

  const url = `${endpoint}?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weathercode&start_date=${dateFrom}&end_date=${effectiveDateTo}&timezone=auto`;

  console.log(
    JSON.stringify({ event: "weather_fetch", endpoint, dateFrom, dateTo: effectiveDateTo }),
  );
  const response = await axios.get<OpenMeteoResponse>(url);
  return response.data;
}

function rowsFromResponse(
  geo: GeoResult,
  data: OpenMeteoResponse,
): Record<string, unknown>[] {
  const {
    time,
    temperature_2m_max,
    temperature_2m_min,
    precipitation_sum,
    wind_speed_10m_max,
    weathercode,
  } = data.daily;

  return time.map((date, i) => ({
    date,
    lat: geo.latitude,
    lon: geo.longitude,
    temperature_max: temperature_2m_max[i] ?? null,
    temperature_min: temperature_2m_min[i] ?? null,
    precipitation: precipitation_sum[i] ?? null,
    wind_speed: wind_speed_10m_max[i] ?? null,
    description: describeCode(weathercode[i] ?? 0),
    raw: {
      date,
      daily_index: i,
      weathercode: weathercode[i],
      source: "open-meteo",
    },
  }));
}

const weatherConfig: DomainConfigV2 = {
  identity: {
    name: "weather",
    displayName: "Weather",
    description: "Global weather forecasts and historical data from Open-Meteo",
    countries: [],
    intents: ["weather"],
  },
  source: {
    type: "rest",
    endpoint: "https://api.open-meteo.com/v1/forecast",
  },
  template: {
    type: "forecasts",
    capabilities: { has_time_series: true },
  },
  fields: {
    date: { source: "date", type: "time", role: "time", format: "YYYY-MM-DD" },
    temperature_max: { source: "temperature_max", type: "number", role: "metric" },
    temperature_min: { source: "temperature_min", type: "number", role: "metric" },
    precipitation: { source: "precipitation", type: "number", role: "metric" },
    wind_speed: { source: "wind_speed", type: "number", role: "metric" },
    description: { source: "description", type: "string", role: "label" },
  },
  time: { type: "realtime" },
  recovery: [],
  storage: {
    storeResults: true,
    tableName: "query_results",
    prismaModel: "queryResult",
    extrasStrategy: "discard",
    defaultOrderBy: { date: "asc" },
  },
  visualisation: { default: "dashboard", rules: [] },
  rateLimit: { requestsPerMinute: 60 },
  cache: { ttlHours: 1 },
};

export const weatherAdapter: DomainAdapter = {
  config: weatherConfig,

  async fetchData(plan: any): Promise<unknown[]> {
    const today = new Date().toISOString().slice(0, 10);
    const currentMonth = today.slice(0, 7); // "YYYY-MM"

    let dateFrom: string;
    let dateTo: string;

    if (plan.date_from.length === 7 && plan.date_from === currentMonth) {
      // Current month → 7-day forecast from today
      dateFrom = today;
      dateTo = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
    } else if (plan.date_from.length === 7) {
      // Historical month — expand to full month range
      dateFrom = `${plan.date_from}-01`;
      dateTo = new Date(
        parseInt(plan.date_to.slice(0, 4)),
        parseInt(plan.date_to.slice(5, 7)),
        0, // day 0 = last day of previous month
      )
        .toISOString()
        .slice(0, 10);
    } else {
      // Already YYYY-MM-DD (from follow-ups etc.)
      dateFrom = plan.date_from;
      dateTo = plan.date_to;
    }

    const geo = await geocodeLocation(plan.location);
    const data = await fetchWeatherForDates(
      geo.latitude,
      geo.longitude,
      dateFrom,
      dateTo,
    );
    return rowsFromResponse(geo, data);
  },

  flattenRow(row: unknown): Record<string, unknown> {
    return row as Record<string, unknown>;
  },

  async storeResults(
    queryId: string,
    rows: unknown[],
    prismaClient: any,
  ): Promise<void> {
    if (rows.length === 0) return;

    await prismaClient.queryResult.createMany({
      data: (rows as Record<string, unknown>[]).map((row) => ({
        query_id: queryId,
        domain_name: "weather",
        source_tag: "open-meteo",
        date: row.date ? new Date(row.date as string) : null,
        lat: (row.lat as number) ?? null,
        lon: (row.lon as number) ?? null,
        location: null,
        description: (row.description as string) ?? null,
        category: null,
        // Primary metric: max temperature; remaining metrics in extras
        value: (row.temperature_max as number) ?? null,
        raw: (row.raw as object) ?? row,
        extras: {
          temperature_min: (row.temperature_min as number) ?? null,
          precipitation: (row.precipitation as number) ?? null,
          wind_speed: (row.wind_speed as number) ?? null,
        },
        snapshot_id: null,
      })),
    });
  },

  async recoverFromEmpty(
    plan: any,
    _poly: string,
    _prisma: any,
  ): Promise<{ data: unknown[]; fallback: FallbackInfo } | null> {
    const today = new Date().toISOString().slice(0, 10);

    // Only apply fallback if the requested date is in the future
    if (plan.date_from <= today) return null;

    const fallback: FallbackInfo = {
      field: "date",
      original: plan.date_from,
      used: today,
      explanation: `No forecast data available for ${plan.date_from} — showing today's weather instead.`,
    };

    const geo = await geocodeLocation(plan.location);
    const data = await fetchWeatherForDates(
      geo.latitude,
      geo.longitude,
      today,
      today,
    );
    const rows = rowsFromResponse(geo, data);

    return { data: rows, fallback };
  },
};
