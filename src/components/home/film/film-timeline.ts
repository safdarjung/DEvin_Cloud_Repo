// "Fabric in 90 seconds": section spans for the one Remotion composition (FabricFilm.tsx). Pure, relative
// `.ts` imports only, because scripts/film/render.mjs loads it under plain node.
import { PROBLEMS, STORIES } from "../story.ts";

export const FILM_FPS = 30;
export const FILM_WIDTH = 1280;
export const FILM_HEIGHT = 720;
/** Half-length of the wipe that hides each cut; purely visual, it does not move any span. */
export const FILM_WIPE = 9;

const OPEN = 150;
const PROBLEM = 72;
const WEAVE = 180;
const STORY_TITLE = 75;
const STEP = 165;
const OUTCOME = 100;
const PEOPLE = 165;
const AI = 225;
const NUMBERS = 180;
const END = 180;

export interface Span {
  from: number;
  duration: number;
}

export function filmTimeline(problemCount: number, stepCount: number) {
  let at = 0;
  const next = (duration: number): Span => {
    const s = { from: at, duration };
    at += duration;
    return s;
  };
  const many = (n: number, duration: number) => Array.from({ length: Math.max(0, Math.floor(n)) }, () => next(duration));
  const open = next(OPEN);
  const problems = many(problemCount, PROBLEM);
  const weave = next(WEAVE);
  const storyTitle = next(STORY_TITLE);
  const story = many(stepCount, STEP);
  const outcome = next(OUTCOME);
  const people = next(PEOPLE);
  const ai = next(AI);
  const numbers = next(NUMBERS);
  const end = next(END);
  const spans = [open, ...problems, weave, storyTitle, ...story, outcome, people, ai, numbers, end];
  // The montage cards push each other sideways, so a wipe enters the montage but none plays between its cards.
  const sections = [...problems.slice(0, 1), weave, storyTitle, ...story, outcome, people, ai, numbers, end];
  return { open, problems, weave, storyTitle, story, outcome, people, ai, numbers, end, spans, cuts: sections.map((s) => s.from), durationInFrames: at };
}

export type FilmTimeline = ReturnType<typeof filmTimeline>;

export const FILM = filmTimeline(PROBLEMS.length, STORIES[0].steps.length);
