/**
 * poly.ts — Shared polygon parsing utility
 *
 * The geocoder outputs polygons as "lat,lon:lat,lon:..." strings
 * (ST_Y = lat, ST_X = lon, colon-separated, 16-point 5km circle).
 *
 * Each API expects a different format. This module provides a single
 * parse step with typed conversion methods so adapters never need to
 * guess the coordinate order.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Bbox {
  /** min longitude */
  xmin: number;
  /** min latitude */
  ymin: number;
  /** max longitude */
  xmax: number;
  /** max latitude */
  ymax: number;
}

export interface ParsedPoly {
  pairs: LatLon[];
  toBbox(): Bbox;
  toOverpassPoly(): string;
  toPoliceUk(): string;
  toArcGisEnvelope(): string;
  centroid(): LatLon;
}

/**
 * Parse the geocoder polygon string into structured data.
 *
 * @param poly  "lat,lon:lat,lon:..." from geocodeToPolygon()
 */
export function parsePoly(poly: string): ParsedPoly {
  const pairs: LatLon[] = poly.split(":").map((pair) => {
    const [lat, lon] = pair.split(",").map(Number);
    return { lat, lon };
  });

  return {
    pairs,

    /** WGS84 bounding box — x = longitude, y = latitude */
    toBbox(): Bbox {
      const lats = pairs.map((p) => p.lat);
      const lons = pairs.map((p) => p.lon);
      return {
        xmin: Math.min(...lons),
        ymin: Math.min(...lats),
        xmax: Math.max(...lons),
        ymax: Math.max(...lats),
      };
    },

    /** Overpass poly filter: "lat1 lon1 lat2 lon2 ..." */
    toOverpassPoly(): string {
      return pairs.map((p) => `${p.lat} ${p.lon}`).join(" ");
    },

    /** Police.uk API format — passthrough */
    toPoliceUk(): string {
      return poly;
    },

    /** ArcGIS REST envelope — JSON string for geometry param */
    toArcGisEnvelope(): string {
      const bbox = this.toBbox();
      return JSON.stringify({
        xmin: bbox.xmin,
        ymin: bbox.ymin,
        xmax: bbox.xmax,
        ymax: bbox.ymax,
      });
    },

    /** Arithmetic mean centroid */
    centroid(): LatLon {
      const sum = pairs.reduce(
        (acc, p) => ({ lat: acc.lat + p.lat, lon: acc.lon + p.lon }),
        { lat: 0, lon: 0 },
      );
      return {
        lat: sum.lat / pairs.length,
        lon: sum.lon / pairs.length,
      };
    },
  };
}
