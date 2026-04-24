import { useRef } from "react";
import type { VideoSpec } from "./types";
import { usePlayer } from "./usePlayer";
import { SceneRenderer } from "./SceneRenderer";

interface Props {
  spec: VideoSpec;
  onClose: () => void;
}

function formatTime(frames: number, fps: number) {
  const secs = Math.floor(frames / fps);
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function VideoPlayer({ spec, onClose }: Props) {
  const { state, play, pause, seek, restart } = usePlayer(spec);
  const scrubRef = useRef<HTMLDivElement>(null);
  const currentScene = spec.scenes[state.sceneIndex];

  const handleScrubClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = scrubRef.current?.getBoundingClientRect();
    if (!rect) return;
    seek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 100, backdropFilter: "blur(8px)",
    }}>
      <div style={{ width: "min(860px, 95vw)", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", paddingBottom: "16px" }}>
          <div>
            <div style={{ fontSize: "10px", letterSpacing: "0.25em", textTransform: "uppercase", color: "#e8b84b", fontFamily: "monospace", marginBottom: "6px" }}>
              Video Guide · {spec.domain}
            </div>
            <h2 style={{ fontSize: "clamp(16px, 2.5vw, 22px)", fontWeight: 700, color: "#f0ede8", fontFamily: "'Georgia', serif", margin: 0 }}>
              {spec.title}
            </h2>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.5)", borderRadius: "4px", padding: "6px 14px", cursor: "pointer", fontSize: "11px", letterSpacing: "0.1em", fontFamily: "monospace", flexShrink: 0 }}>
            CLOSE
          </button>
        </div>

        {/* Viewport */}
        <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", background: "#0a1018", borderRadius: "6px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
          {currentScene && <SceneRenderer scene={currentScene} sceneProgress={state.sceneProgress} />}

          {/* Caption */}
          {currentScene && (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "24px 24px 20px", background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)" }}>
              <p style={{ margin: 0, fontSize: "clamp(12px, 1.8vw, 15px)", color: "rgba(255,255,255,0.88)", lineHeight: 1.5, fontFamily: "'Georgia', serif", maxWidth: "80%" }}>
                {currentScene.caption}
              </p>
            </div>
          )}

          {/* Scene dots */}
          <div style={{ position: "absolute", top: "14px", right: "16px", display: "flex", gap: "6px" }}>
            {spec.scenes.map((_, i) => (
              <div key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", background: i === state.sceneIndex ? "#e8b84b" : "rgba(255,255,255,0.25)", transition: "background 0.3s" }} />
            ))}
          </div>

          {/* Initial play overlay */}
          {!state.playing && state.frame === 0 && (
            <div onClick={play} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: "rgba(0,0,0,0.2)" }}>
              <div style={{ width: "64px", height: "64px", borderRadius: "50%", background: "rgba(232,184,75,0.15)", border: "2px solid #e8b84b", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="#e8b84b"><path d="M6 4l12 6-12 6V4z" /></svg>
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div style={{ paddingTop: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* Scrub bar */}
          <div ref={scrubRef} onClick={handleScrubClick} style={{ height: "4px", background: "rgba(255,255,255,0.1)", borderRadius: "2px", cursor: "pointer", position: "relative" }}>
            {/* Scene segment dividers */}
            {(() => {
              let acc = 0;
              return spec.scenes.map((scene, i) => {
                const start = acc / spec.totalFrames;
                const width = scene.duration / spec.totalFrames;
                acc += scene.duration;
                return <div key={i} style={{ position: "absolute", left: `${start * 100}%`, width: `${width * 100}%`, top: "-2px", bottom: "-2px", borderRight: i < spec.scenes.length - 1 ? "1px solid rgba(0,0,0,0.4)" : "none" }} />;
              });
            })()}
            {/* Fill */}
            <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${state.progress * 100}%`, background: "#e8b84b", borderRadius: "2px", transition: "none" }} />
            {/* Head */}
            <div style={{ position: "absolute", top: "50%", left: `${state.progress * 100}%`, transform: "translate(-50%, -50%)", width: "12px", height: "12px", borderRadius: "50%", background: "#e8b84b" }} />
          </div>

          {/* Button row */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button onClick={restart} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", padding: "4px", display: "flex" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 8a6 6 0 1 1 1.5 4L2 13.5V10H5l-1.1-1.1A4.5 4.5 0 1 0 4.5 4.5" /></svg>
            </button>
            <button onClick={state.playing ? pause : play} style={{ background: "#e8b84b", border: "none", borderRadius: "50%", width: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
              {state.playing
                ? <svg width="12" height="12" viewBox="0 0 12 12" fill="#0f1923"><rect x="2" y="1" width="3" height="10" rx="1" /><rect x="7" y="1" width="3" height="10" rx="1" /></svg>
                : <svg width="12" height="12" viewBox="0 0 12 12" fill="#0f1923"><path d="M3 2l8 4-8 4V2z" /></svg>
              }
            </button>
            <span style={{ fontSize: "11px", fontFamily: "monospace", color: "rgba(255,255,255,0.4)" }}>
              {formatTime(state.frame, spec.fps)} / {formatTime(spec.totalFrames, spec.fps)}
            </span>
            <span style={{ marginLeft: "auto", fontSize: "10px", letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>
              Scene {state.sceneIndex + 1} / {spec.scenes.length}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
