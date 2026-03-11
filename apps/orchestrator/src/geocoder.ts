import { NominatimResponseSchema, CoordinatesSchema, PolygonSchema } from "@dredge/schemas";

// TODO: implement geocodeToPolygon(location: string): Promise<{ poly: string, display_name: string }>
// - call https://nominatim.openstreetmap.org/search
// - params: { q: location, format: "json", limit: 1 }
// - set User-Agent: "dredge/1.0" header — Nominatim requires this
// - validate response with NominatimResponseSchema.parse()
// - throw structured IntentError { error: "geocode_failed", ... } if result array is empty
// - extract boundingbox: [south, north, west, east] — parse all values to numbers
// - convert to poly format: "north,west:north,east:south,east:south,west"
// - validate with PolygonSchema.parse() before returning
// - return { poly, display_name }

export async function geocodeToPolygon(
  _location: string
): Promise<{ poly: string; display_name: string }> {
  throw new Error("TODO: implement geocodeToPolygon");
}

// TODO: implement geocodeToCoordinates(location: string): Promise<{ lat: number, lon: number, display_name: string }>
// - same Nominatim call as geocodeToPolygon
// - extract lat, lon, display_name — parse lat/lon to numbers
// - validate with CoordinatesSchema.parse()
// Forward-compatibility: used by weather/traffic/events domains, not crime

export async function geocodeToCoordinates(
  _location: string
): Promise<{ lat: number; lon: number; display_name: string }> {
  throw new Error("TODO: implement geocodeToCoordinates");
}
