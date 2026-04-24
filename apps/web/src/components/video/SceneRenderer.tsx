import type { VideoScene } from "./types";

interface Props {
  scene: VideoScene;
  sceneProgress: number; // 0–1
}

// ── Image scene ───────────────────────────────────────────────────────────────
function ImageScene({ scene, sceneProgress }: Props) {
  const asset = scene.asset as Extract<VideoScene["asset"], { type: "image" }>;
  const opacity =
    sceneProgress < 0.1 ? sceneProgress / 0.1
    : sceneProgress > 0.9 ? (1 - sceneProgress) / 0.1
    : 1;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <img
        src={asset.url}
        alt=""
        style={{
          width: "100%", height: "100%", objectFit: asset.fit, opacity,
          transform: `scale(${1 + sceneProgress * 0.04})`,
          transition: "none",
        }}
      />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%)" }} />
    </div>
  );
}

// ── Text scene ────────────────────────────────────────────────────────────────
function TextScene({ scene, sceneProgress }: Props) {
  const asset = scene.asset as Extract<VideoScene["asset"], { type: "text" }>;
  const lines = asset.body.split("\n");
  const opacity = sceneProgress < 0.08 ? sceneProgress / 0.08 : 1;

  return (
    <div style={{
      display: "flex", flexDirection: "column", justifyContent: "center",
      alignItems: "flex-start", height: "100%", padding: "48px 56px",
      opacity, background: "linear-gradient(135deg, #0f1923 0%, #1a2535 100%)",
    }}>
      <div style={{ fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#e8b84b", marginBottom: "20px", fontFamily: "monospace" }}>
        Guide
      </div>
      <h2 style={{ fontSize: "clamp(20px, 3vw, 32px)", fontWeight: 700, color: "#f0ede8", marginBottom: "28px", lineHeight: 1.2, fontFamily: "'Georgia', serif" }}>
        {asset.heading}
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {lines.map((line, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "flex-start", gap: "14px",
            opacity: sceneProgress > i * 0.15 ? 1 : 0,
            transform: `translateX(${sceneProgress > i * 0.15 ? 0 : -12}px)`,
            transition: "opacity 0.3s, transform 0.3s",
          }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#e8b84b", marginTop: "7px", flexShrink: 0 }} />
            <span style={{ fontSize: "clamp(13px, 2vw, 16px)", color: "#c8c5c0", lineHeight: 1.6, fontFamily: "'Georgia', serif" }}>
              {line.replace(/^\d+\.\s*/, "")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Chart scene ───────────────────────────────────────────────────────────────
function ChartScene({ scene, sceneProgress }: Props) {
  const asset = scene.asset as Extract<VideoScene["asset"], { type: "chart" }>;
  const maxValue = Math.max(...asset.data.map((d) => d.value));
  const animProgress = Math.min(sceneProgress * 2, 1);

  if (asset.chartType === "line") {
    const pts = asset.data;
    const w = 500, h = 140;
    const pad = { l: 30, r: 10, t: 10, b: 30 };
    const chartW = w - pad.l - pad.r;
    const chartH = h - pad.t - pad.b;
    const minV = Math.min(...pts.map((d) => d.value));
    const maxV = Math.max(...pts.map((d) => d.value));
    const xStep = chartW / (pts.length - 1);
    const yScale = (v: number) => chartH - ((v - minV) / (maxV - minV)) * chartH;
    const visibleCount = Math.max(1, Math.floor(animProgress * pts.length));
    const pathD = pts.slice(0, visibleCount)
      .map((d, i) => `${i === 0 ? "M" : "L"} ${pad.l + i * xStep} ${pad.t + yScale(d.value)}`)
      .join(" ");

    return (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "40px 48px", background: "linear-gradient(135deg, #0f1923 0%, #1a2535 100%)" }}>
        <div style={{ fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#e8b84b", marginBottom: "16px", fontFamily: "monospace" }}>Trend</div>
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", maxHeight: "160px" }}>
          {[0.25, 0.5, 0.75, 1].map((t) => (
            <line key={t} x1={pad.l} y1={pad.t + chartH * (1 - t)} x2={pad.l + chartW} y2={pad.t + chartH * (1 - t)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          ))}
          <path d={pathD} fill="none" stroke="#e8b84b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {pts.slice(0, visibleCount).map((d, i) => (
            <circle key={i} cx={pad.l + i * xStep} cy={pad.t + yScale(d.value)} r="4" fill="#e8b84b" />
          ))}
          {pts.map((d, i) => (
            <text key={i} x={pad.l + i * xStep} y={h - 6} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9" fontFamily="monospace">{d.label}</text>
          ))}
        </svg>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "40px 48px", background: "linear-gradient(135deg, #0f1923 0%, #1a2535 100%)" }}>
      <div style={{ fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "#e8b84b", marginBottom: "20px", fontFamily: "monospace" }}>Data</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {asset.data.map((d, i) => {
          const barProgress = Math.max(0, Math.min(1, (animProgress - i * 0.1) / 0.5));
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span style={{ width: "120px", flexShrink: 0, fontSize: "11px", color: "rgba(255,255,255,0.6)", fontFamily: "monospace", textAlign: "right" }}>{d.label}</span>
              <div style={{ flex: 1, height: "22px", background: "rgba(255,255,255,0.06)", borderRadius: "3px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(d.value / maxValue) * 100 * barProgress}%`, background: "linear-gradient(90deg, #c8914a, #e8b84b)", borderRadius: "3px", transition: "none" }} />
              </div>
              <span style={{ width: "48px", fontSize: "11px", color: "#e8b84b", fontFamily: "monospace" }}>{barProgress > 0.8 ? d.value : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Map scene ─────────────────────────────────────────────────────────────────
function MapScene({ scene, sceneProgress }: Props) {
  const asset = scene.asset as Extract<VideoScene["asset"], { type: "map" }>;
  const opacity = sceneProgress < 0.12 ? sceneProgress / 0.12 : 1;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", opacity }}>
      <iframe
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${asset.lon - 2},${asset.lat - 1.5},${asset.lon + 2},${asset.lat + 1.5}&layer=mapnik`}
        style={{ width: "100%", height: "100%", border: "none", filter: "invert(90%) hue-rotate(200deg) saturate(0.4) brightness(0.8)" }}
        title="map"
      />
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.5) 100%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "16px", height: "16px", border: "2px solid #e8b84b", borderRadius: "50%", boxShadow: "0 0 0 4px rgba(232,184,75,0.2)" }} />
    </div>
  );
}

// ── Scene dispatcher ──────────────────────────────────────────────────────────
export function SceneRenderer({ scene, sceneProgress }: Props) {
  switch (scene.asset.type) {
    case "image": return <ImageScene scene={scene} sceneProgress={sceneProgress} />;
    case "text":  return <TextScene  scene={scene} sceneProgress={sceneProgress} />;
    case "chart": return <ChartScene scene={scene} sceneProgress={sceneProgress} />;
    case "map":   return <MapScene   scene={scene} sceneProgress={sceneProgress} />;
  }
}
