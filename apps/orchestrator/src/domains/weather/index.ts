import axios from "axios";
import { DomainAdapter } from "../registry";
import { FallbackInfo } from "@dredge/schemas";

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
  windspeed_10m_max: number[]; // ← no underscore between wind and speed
  weathercode: number[];
}

interface OpenMeteoResponse {
  daily: OpenMeteoDaily;
}
async function geocodeLocation(location: string): Promise<GeoResult> {
  const cityName = location.split(",")[0].trim();
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
  const endpoint =
    dateTo < today
      ? "https://archive-api.open-meteo.com/v1/archive"
      : "https://api.open-meteo.com/v1/forecast";

  const url = `${endpoint}?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,weathercode&start_date=${dateFrom}&end_date=${dateTo}&timezone=auto`;

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
    windspeed_10m_max,
    weathercode,
  } = data.daily;

  console.log("daily keys:", Object.keys(data.daily));
  console.log(
    "time:",
    time?.length,
    "temp_max:",
    temperature_2m_max?.length,
    "windspeed:",
    windspeed_10m_max?.length,
  );

  return time.map((date, i) => ({
    date,
    latitude: geo.latitude,
    longitude: geo.longitude,
    temperature_max: temperature_2m_max[i] ?? null,
    temperature_min: temperature_2m_min[i] ?? null,
    precipitation: precipitation_sum[i] ?? null,
    wind_speed: windspeed_10m_max[i] ?? null,
    description: describeCode(weathercode[i] ?? 0),
    raw: {
      date,
      daily_index: i,
      weathercode: weathercode[i],
      source: "open-meteo",
    },
  }));
}

export const weatherAdapter: DomainAdapter = {
  config: {
    name: "weather",
    tableName: "weather_results",
    prismaModel: "weatherResult",
    countries: [],
    intents: ["weather"],
    apiUrl: "https://api.open-meteo.com/v1/forecast",
    apiKeyEnv: null,
    locationStyle: "coordinates",
    params: {},
    flattenRow: { raw: "$" },
    categoryMap: {},
    vizHintRules: { defaultHint: "dashboard", multiMonthHint: "dashboard" },
    rateLimit: { requestsPerMinute: 60 },
    defaultOrderBy: { date: "asc" },
    cacheTtlHours: 1,
  },

  async fetchData(plan: any): Promise<unknown[]> {
    if (!process.env.OPENWEATHER_API_KEY) {
      throw new Error(
        "OPENWEATHER_API_KEY is not set. Add it to your .env file.",
      );
    }

    // plan.date_from may be YYYY-MM (from crime pipeline) or YYYY-MM-DD
    // Normalise to full dates for Open-Meteo
    const dateFrom =
      plan.date_from.length === 7 ? `${plan.date_from}-01` : plan.date_from;

    // Last day of the month if only YYYY-MM provided
    const dateTo =
      plan.date_to.length === 7
        ? new Date(
            parseInt(plan.date_to.slice(0, 4)),
            parseInt(plan.date_to.slice(5, 7)),
            0, // day 0 = last day of previous month
          )
            .toISOString()
            .slice(0, 10)
        : plan.date_to;

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
    prisma: any,
  ): Promise<void> {
    if (rows.length === 0) return;

    await prisma.weatherResult.createMany({
      data: (rows as Record<string, unknown>[]).map((row) => ({
        query_id: queryId,
        date: row.date as string,
        latitude: row.latitude as number | null,
        longitude: row.longitude as number | null,
        temperature_max: row.temperature_max as number | null,
        temperature_min: row.temperature_min as number | null,
        precipitation: row.precipitation as number | null,
        wind_speed: row.wind_speed as number | null,
        description: row.description as string | null,
        raw: row.raw ?? null,
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
