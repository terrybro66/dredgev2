import { useRef, useEffect } from "react";
import * as d3Scale from "d3-scale";
import * as d3Shape from "d3-shape";
import * as d3Axis from "d3-axis";
import * as d3Selection from "d3-selection";
import type { QueryRow, WeatherRow } from "../types";

// ── MetricCards ───────────────────────────────────────────────────────────────

function MetricCards({ rows }: { rows: WeatherRow[] }) {
  const validRows = rows.filter(
    (r) => r.temperature_max != null && r.temperature_min != null,
  );

  const avgTemp =
    validRows.length > 0
      ? validRows.reduce(
          (sum, r) => sum + (r.temperature_max! + r.temperature_min!) / 2,
          0,
        ) / validRows.length
      : null;

  const totalPrecip = rows.reduce((sum, r) => sum + (r.precipitation ?? 0), 0);

  const avgWind =
    rows.filter((r) => r.wind_speed != null).length > 0
      ? rows.reduce((sum, r) => sum + (r.wind_speed ?? 0), 0) /
        rows.filter((r) => r.wind_speed != null).length
      : null;

  const descCounts: Record<string, number> = {};
  rows.forEach((r) => {
    if (r.description)
      descCounts[r.description] = (descCounts[r.description] ?? 0) + 1;
  });
  const dominantDesc =
    Object.entries(descCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

  const cards = [
    {
      label: "Avg Temperature",
      value: avgTemp != null ? `${avgTemp.toFixed(1)}°C` : "—",
    },
    { label: "Total Precipitation", value: `${totalPrecip.toFixed(1)} mm` },
    {
      label: "Avg Wind Speed",
      value: avgWind != null ? `${avgWind.toFixed(1)} km/h` : "—",
    },
    { label: "Dominant Conditions", value: dominantDesc },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "0.75rem",
        marginBottom: "1.5rem",
      }}
    >
      {cards.map((c) => (
        <div
          key={c.label}
          style={{
            background: "var(--bg-card, #1a1a2e)",
            border: "1px solid var(--border, #2a2a4a)",
            borderRadius: "8px",
            padding: "1rem",
          }}
        >
          <div
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted, #888)",
              marginBottom: "0.4rem",
            }}
          >
            {c.label}
          </div>
          <div
            style={{
              fontSize: "1.2rem",
              fontWeight: 600,
              color: "var(--text, #fff)",
            }}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── TemperatureChart ──────────────────────────────────────────────────────────

function TemperatureChart({ rows }: { rows: WeatherRow[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 800, H = 240, mt = 20, mr = 20, mb = 40, ml = 50;
  const iW = W - ml - mr;
  const iH = H - mt - mb;

  useEffect(() => {
    if (!svgRef.current || rows.length === 0) return;

    const svg = d3Selection.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g").attr("transform", `translate(${ml},${mt})`);

    const dates = rows.map((r) => new Date(r.date));
    const allTemps = rows.flatMap((r) => [
      r.temperature_max ?? 0,
      r.temperature_min ?? 0,
    ]);
    const tempMin = Math.min(...allTemps);
    const tempMax = Math.max(...allTemps);
    const padding = (tempMax - tempMin) * 0.1 || 2;

    const xScale = d3Scale
      .scaleTime()
      .domain([dates[0], dates[dates.length - 1]])
      .range([0, iW]);

    const yScale = d3Scale
      .scaleLinear()
      .domain([tempMin - padding, tempMax + padding])
      .range([iH, 0]);

    g.append("g")
      .attr("class", "grid")
      .call(
        d3Axis.axisLeft(yScale).tickSize(-iW).tickFormat(() => ""),
      )
      .call((g) => g.select(".domain").remove())
      .call((g) =>
        g
          .selectAll(".tick line")
          .attr("stroke", "var(--border, #2a2a4a)")
          .attr("stroke-opacity", 0.5),
      );

    const area = d3Shape
      .area<WeatherRow>()
      .x((d) => xScale(new Date(d.date)))
      .y0((d) => yScale(d.temperature_min ?? 0))
      .y1((d) => yScale(d.temperature_max ?? 0))
      .curve(d3Shape.curveCatmullRom);

    g.append("path")
      .datum(rows)
      .attr("fill", "rgba(251, 191, 36, 0.25)")
      .attr("stroke", "none")
      .attr("d", area);

    const midLine = d3Shape
      .line<WeatherRow>()
      .x((d) => xScale(new Date(d.date)))
      .y((d) =>
        yScale(((d.temperature_max ?? 0) + (d.temperature_min ?? 0)) / 2),
      )
      .curve(d3Shape.curveCatmullRom);

    g.append("path")
      .datum(rows)
      .attr("fill", "none")
      .attr("stroke", "rgba(251, 191, 36, 0.8)")
      .attr("stroke-width", 1.5)
      .attr("d", midLine);

    const tickCount = rows.length <= 14 ? rows.length : Math.ceil(rows.length / 7);
    g.append("g")
      .attr("transform", `translate(0,${iH})`)
      .call(
        d3Axis.axisBottom(xScale).ticks(tickCount).tickFormat((d) => {
          const date = d as Date;
          return `${date.getDate()} ${date.toLocaleString("en-GB", { month: "short" })}`;
        }),
      )
      .call((g) => g.select(".domain").attr("stroke", "var(--border, #2a2a4a)"))
      .call((g) =>
        g.selectAll("text").attr("fill", "var(--text-muted, #888)").attr("font-size", "11px"),
      );

    g.append("g")
      .call(d3Axis.axisLeft(yScale).tickFormat((d) => `${d}°C`))
      .call((g) => g.select(".domain").attr("stroke", "var(--border, #2a2a4a)"))
      .call((g) =>
        g.selectAll("text").attr("fill", "var(--text-muted, #888)").attr("font-size", "11px"),
      );

    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -iH / 2)
      .attr("y", -38)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--text-muted, #888)")
      .attr("font-size", "11px")
      .text("°C");
  }, [rows]);

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div style={{ fontSize: "0.8rem", color: "var(--text-muted, #888)", marginBottom: "0.5rem", fontWeight: 500 }}>
        TEMPERATURE RANGE
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} />
    </div>
  );
}

// ── PrecipitationChart ────────────────────────────────────────────────────────

function PrecipitationChart({ rows }: { rows: WeatherRow[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 800, H = 240, mt = 20, mr = 20, mb = 40, ml = 50;
  const iW = W - ml - mr;
  const iH = H - mt - mb;

  useEffect(() => {
    if (!svgRef.current || rows.length === 0) return;

    const svg = d3Selection.select(svgRef.current);
    svg.selectAll("*").remove();

    const g = svg.append("g").attr("transform", `translate(${ml},${mt})`);

    const xScale = d3Scale
      .scaleBand()
      .domain(rows.map((r) => r.date))
      .range([0, iW])
      .padding(0.15);

    const maxPrecip = Math.max(...rows.map((r) => r.precipitation ?? 0));
    const yScale = d3Scale
      .scaleLinear()
      .domain([0, maxPrecip * 1.1 || 1])
      .range([iH, 0]);

    g.selectAll(".bar")
      .data(rows)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (d) => xScale(d.date) ?? 0)
      .attr("y", (d) => yScale(d.precipitation ?? 0))
      .attr("width", xScale.bandwidth())
      .attr("height", (d) => Math.max(1, iH - yScale(d.precipitation ?? 0)))
      .attr("fill", "rgba(59, 130, 246, 0.7)")
      .attr("rx", 2);

    const tickCount = rows.length <= 14 ? rows.length : Math.ceil(rows.length / 7);
    const tickDates = rows
      .filter((_, i) => i % Math.ceil(rows.length / tickCount) === 0)
      .map((r) => r.date);

    g.append("g")
      .attr("transform", `translate(0,${iH})`)
      .call(
        d3Axis.axisBottom(xScale).tickValues(tickDates).tickFormat((d) => {
          const date = new Date(d);
          return `${date.getDate()} ${date.toLocaleString("en-GB", { month: "short" })}`;
        }),
      )
      .call((g) => g.select(".domain").attr("stroke", "var(--border, #2a2a4a)"))
      .call((g) =>
        g.selectAll("text").attr("fill", "var(--text-muted, #888)").attr("font-size", "11px"),
      );

    g.append("g")
      .call(d3Axis.axisLeft(yScale).tickFormat((d) => `${d}mm`))
      .call((g) => g.select(".domain").attr("stroke", "var(--border, #2a2a4a)"))
      .call((g) =>
        g.selectAll("text").attr("fill", "var(--text-muted, #888)").attr("font-size", "11px"),
      );

    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -iH / 2)
      .attr("y", -38)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--text-muted, #888)")
      .attr("font-size", "11px")
      .text("mm");
  }, [rows]);

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div style={{ fontSize: "0.8rem", color: "var(--text-muted, #888)", marginBottom: "0.5rem", fontWeight: 500 }}>
        PRECIPITATION
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }} />
    </div>
  );
}

// ── ConditionsTimeline ────────────────────────────────────────────────────────

function ConditionsTimeline({ rows }: { rows: WeatherRow[] }) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <div style={{ fontSize: "0.8rem", color: "var(--text-muted, #888)", marginBottom: "0.5rem", fontWeight: 500 }}>
        CONDITIONS
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
        {rows.map((r) => (
          <div
            key={r.id}
            style={{
              background: "var(--bg-card, #1a1a2e)",
              border: "1px solid var(--border, #2a2a4a)",
              borderRadius: "6px",
              padding: "0.35rem 0.6rem",
              fontSize: "0.75rem",
              color: "var(--text-muted, #888)",
            }}
          >
            <span style={{ color: "var(--text, #fff)", fontWeight: 500 }}>
              {new Date(r.date).getDate()}{" "}
              {new Date(r.date).toLocaleString("en-GB", { month: "short" })}
            </span>
            {" · "}
            {r.description ?? "—"}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── DashboardView ─────────────────────────────────────────────────────────────
// After the query_results storage migration, weather fields are split:
//   temperature_max → stored as `value`
//   temperature_min, precipitation, wind_speed → stored inside `extras` JSONB
// Normalise here so sub-components receive a fully-populated WeatherRow.

export function DashboardView({ rows }: { rows: QueryRow[] }) {
  const weatherRows: WeatherRow[] = rows.map((r) => {
    const extras =
      r.extras && typeof r.extras === "object"
        ? (r.extras as Record<string, unknown>)
        : {};
    return {
      id: String(r.id ?? ""),
      date: String(r.date ?? ""),
      temperature_max:
        (r.temperature_max as number | null) ??
        (r.value as number | null) ??
        null,
      temperature_min:
        (r.temperature_min as number | null) ??
        (extras.temperature_min as number | null) ??
        null,
      precipitation:
        (r.precipitation as number | null) ??
        (extras.precipitation as number | null) ??
        null,
      wind_speed:
        (r.wind_speed as number | null) ??
        (extras.wind_speed as number | null) ??
        null,
      description: (r.description as string | null) ?? null,
    };
  });

  const isMultiDay = weatherRows.length > 1;

  return (
    <div style={{ padding: "1rem 0" }}>
      <MetricCards rows={weatherRows} />
      {isMultiDay && <TemperatureChart rows={weatherRows} />}
      {isMultiDay && <PrecipitationChart rows={weatherRows} />}
      <ConditionsTimeline rows={weatherRows} />
    </div>
  );
}
