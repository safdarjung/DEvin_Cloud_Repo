export const EXPLAINER_FPS = 30;
export const EXPLAINER_WIDTH = 1280;
export const EXPLAINER_HEIGHT = 720;
export const TITLE_FRAMES = 75;
export const BEAT_FRAMES = 90;
export const END_FRAMES = 75;

export interface Span {
  from: number;
  duration: number;
}

export function explainerTimeline(featureCount: number) {
  const n = Math.max(0, Math.floor(featureCount));
  const beats: Span[] = Array.from({ length: n }, (_, i) => ({
    from: TITLE_FRAMES + i * BEAT_FRAMES,
    duration: BEAT_FRAMES,
  }));
  const endFrom = TITLE_FRAMES + n * BEAT_FRAMES;
  return {
    title: { from: 0, duration: TITLE_FRAMES } as Span,
    beats,
    end: { from: endFrom, duration: END_FRAMES } as Span,
    durationInFrames: endFrom + END_FRAMES,
  };
}
