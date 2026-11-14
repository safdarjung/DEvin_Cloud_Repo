import type { VideoId } from "./content";

export type VideoEntry = {
  title: string;
  description: string;
  webm?: string;
  mp4?: string;
  poster?: string;
  captions?: string;
  width: number;
  height: number;
  durationSec?: number;
};

// Screen recordings of the running app's demo school (sample data), made by
// scripts/fabricos/record-videos.mjs. An entry without webm/mp4 makes
// <ProductVideo> render nothing.
const asset = (id: VideoId) => ({
  webm: `/fabricos/video/${id}.webm`,
  mp4: `/fabricos/video/${id}.mp4`,
  poster: `/fabricos/video/${id}.jpg`,
  captions: `/fabricos/video/${id}.vtt`,
  width: 1440,
  height: 900,
});

export const VIDEOS: Record<VideoId, VideoEntry> = {
  overview: {
    title: "A walkthrough of the workspace",
    description:
      "Screen recording of the running app with a demo school's sample data: the principal dashboard, the module sidebar, then admissions, attendance, finance and exams.",
    ...asset("overview"),
    durationSec: 37,
  },
  agents: {
    title: "AI agents that propose, not act",
    description:
      "Screen recording of the AI workforce page: each agent's scope, what it can suggest and which suggestions need approval. No agent is run in this clip.",
    ...asset("agents"),
    durationSec: 16,
  },
  automation: {
    title: "Workflows with a human decision",
    description:
      "Screen recording of the workflows list, then a seeded demo agent run held for approval. The run proposes fee reminders and waits for the principal to approve or reject. Nothing is approved in the clip.",
    ...asset("automation"),
    durationSec: 20,
  },
  insights: {
    title: "Insights and analysis lab",
    description:
      "Screen recording of the insights list with domain filters, an insight opened to show its evidence, then the analysis lab comparing attendance with marks across sections.",
    ...asset("insights"),
    durationSec: 14,
  },
  roles: {
    title: "A view for each role",
    description:
      "Screen recording of two separate demo logins: a class teacher's Today page, then a parent's portal for their own children.",
    ...asset("roles"),
    durationSec: 17,
  },
};
