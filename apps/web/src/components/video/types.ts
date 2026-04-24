// VideoSpec — the contract between the video module and the main app.
// This mirrors dredge-video/src/types/video.ts and is the only coupling point.

export type SceneAsset =
  | { type: "image"; url: string; fit: "cover" | "contain" }
  | { type: "map"; lat: number; lon: number; zoom: number }
  | { type: "chart"; data: { label: string; value: number }[]; chartType: "bar" | "line" }
  | { type: "text"; heading: string; body: string };

export type VideoScene = {
  id: string;
  duration: number; // frames at 30fps
  caption: string;
  voiceover?: string;
  asset: SceneAsset;
};

export type VideoSpec = {
  id: string;
  title: string;
  intent: string;
  domain: string;
  scenes: VideoScene[];
  totalFrames: number;
  fps: 30;
  outputFormat: "player" | "mp4";
};

/** Chip shape used by the video module — maps to ChipAction "play_video" */
export type VizChip = {
  label: string;
  vizType: "video";
  context: {
    intent: string;
    domain: string;
    location?: string;
  };
};
