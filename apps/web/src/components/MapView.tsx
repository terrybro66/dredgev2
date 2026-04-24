import { useMemo, useState } from "react";
import Map from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { useControl } from "react-map-gl/maplibre";
import { ScatterplotLayer } from "@deck.gl/layers";
import { HexagonLayer, HeatmapLayer } from "@deck.gl/aggregation-layers";
import "maplibre-gl/dist/maplibre-gl.css";
import type { QueryRow, AggregatedBin } from "../types";

// ── DeckGL overlay ────────────────────────────────────────────────────────────

function DeckGLOverlay(props: any) {
  const overlay = useControl(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCategory(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── MapView ───────────────────────────────────────────────────────────────────

type MapMode = "points" | "clusters" | "heatmap";

export function MapView({
  rows,
  aggregated,
}: {
  rows: QueryRow[] | AggregatedBin[];
  aggregated: boolean;
}) {
  const [mode, setMode] = useState<MapMode>("points");
  const [hover, setHover] = useState<QueryRow | null>(null);

  const points = useMemo(
    () =>
      aggregated
        ? (rows as AggregatedBin[]).map((b) => ({
            lng: b.lon,
            lat: b.lat,
            count: b.count,
          }))
        : (rows as QueryRow[])
            .map((c) => ({
              ...c,
              lng: (c.lon ?? c.longitude) as number,
              lat: (c.lat ?? c.latitude) as number,
            }))
            .filter(
              (c) =>
                c.lng != null &&
                c.lat != null &&
                Number.isFinite(c.lng) &&
                Number.isFinite(c.lat),
            ),
    [rows, aggregated],
  );

  const first = points[0];

  const layers = useMemo(() => {
    if (mode === "points")
      return [
        new ScatterplotLayer({
          id: "dredge-points",
          data: points,
          getPosition: (d: any) => [d.lng, d.lat],
          getRadius: 30,
          radiusUnits: "meters",
          getFillColor: [245, 166, 35, 200],
          pickable: true,
          onHover: (info: any) => setHover(info.object ?? null),
        }),
      ];
    if (mode === "clusters")
      return [
        new HexagonLayer({
          id: "dredge-clusters",
          data: points,
          getPosition: (d: any) => [d.lng, d.lat],
          radius: 200,
          elevationScale: 30,
          extruded: true,
          pickable: true,
        }),
      ];
    if (mode === "heatmap")
      return [
        new HeatmapLayer({
          id: "dredge-heat",
          data: points,
          getPosition: (d: any) => [d.lng, d.lat],
          radiusPixels: 60,
        }),
      ];
    return [];
  }, [points, mode]);

  return (
    <div className="map-container">
      <div className="map-mode-bar">
        {(["points", "clusters", "heatmap"] as MapMode[]).map((m) => (
          <button
            key={m}
            className={`map-mode-btn ${mode === m ? "active" : ""}`}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
      </div>
      <Map
        mapLib={maplibregl}
        initialViewState={{
          longitude: first?.lng ?? -0.1276,
          latitude: first?.lat ?? 51.5074,
          zoom: 12,
          pitch: 40,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="https://tiles.openfreemap.org/styles/liberty"
      >
        <DeckGLOverlay layers={layers} />
      </Map>
      {hover && !aggregated && (
        <div className="map-tooltip">
          <strong>
            {(hover as any).description ??
              formatCategory((hover as any).category ?? "") ??
              "—"}
          </strong>
          {(hover as any).street && <span>{(hover as any).street}</span>}
          {((hover as any).month || (hover as any).date) && (
            <span>{(hover as any).month ?? (hover as any).date}</span>
          )}
          {(hover as any).outcome_category && (
            <em>{(hover as any).outcome_category}</em>
          )}
        </div>
      )}
    </div>
  );
}
