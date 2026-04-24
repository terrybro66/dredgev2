import { useState, useEffect, useRef, useCallback } from "react";
import type { VideoSpec } from "./types";

export type PlayerState = {
  playing: boolean;
  frame: number;
  sceneIndex: number;
  progress: number;      // 0–1 across whole video
  sceneProgress: number; // 0–1 within current scene
};

export function usePlayer(spec: VideoSpec | null) {
  const [state, setState] = useState<PlayerState>({
    playing: false,
    frame: 0,
    sceneIndex: 0,
    progress: 0,
    sceneProgress: 0,
  });

  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const frameRef = useRef(0);

  const getSceneAtFrame = useCallback(
    (frame: number) => {
      if (!spec) return { sceneIndex: 0, sceneProgress: 0 };
      let acc = 0;
      for (let i = 0; i < spec.scenes.length; i++) {
        const scene = spec.scenes[i];
        if (frame < acc + scene.duration) {
          return { sceneIndex: i, sceneProgress: (frame - acc) / scene.duration };
        }
        acc += scene.duration;
      }
      return { sceneIndex: spec.scenes.length - 1, sceneProgress: 1 };
    },
    [spec],
  );

  const tick = useCallback(
    (timestamp: number) => {
      if (!spec) return;
      if (lastTimeRef.current === null) lastTimeRef.current = timestamp;
      const elapsed = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      const framesElapsed = (elapsed / 1000) * spec.fps;
      frameRef.current = Math.min(frameRef.current + framesElapsed, spec.totalFrames - 1);

      const frame = frameRef.current;
      const { sceneIndex, sceneProgress } = getSceneAtFrame(Math.floor(frame));

      setState({ playing: true, frame: Math.floor(frame), sceneIndex, progress: frame / spec.totalFrames, sceneProgress });

      if (frame < spec.totalFrames - 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setState((s) => ({ ...s, playing: false, progress: 1 }));
      }
    },
    [spec, getSceneAtFrame],
  );

  const play = useCallback(() => {
    if (!spec) return;
    lastTimeRef.current = null;
    setState((s) => ({ ...s, playing: true }));
    rafRef.current = requestAnimationFrame(tick);
  }, [spec, tick]);

  const pause = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    setState((s) => ({ ...s, playing: false }));
  }, []);

  const seek = useCallback(
    (progress: number) => {
      if (!spec) return;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      const frame = Math.floor(progress * spec.totalFrames);
      frameRef.current = frame;
      lastTimeRef.current = null;
      const { sceneIndex, sceneProgress } = getSceneAtFrame(frame);
      setState({ playing: false, frame, sceneIndex, progress, sceneProgress });
    },
    [spec, getSceneAtFrame],
  );

  const restart = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    frameRef.current = 0;
    lastTimeRef.current = null;
    setState({ playing: false, frame: 0, sceneIndex: 0, progress: 0, sceneProgress: 0 });
  }, []);

  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    frameRef.current = 0;
    lastTimeRef.current = null;
    setState({ playing: false, frame: 0, sceneIndex: 0, progress: 0, sceneProgress: 0 });
  }, [spec]);

  useEffect(() => {
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, []);

  return { state, play, pause, seek, restart };
}
