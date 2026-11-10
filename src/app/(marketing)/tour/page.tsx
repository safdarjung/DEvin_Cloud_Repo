import { existsSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { TOUR_ROLES } from "@/components/tour/roles";
import { SchoolTour } from "@/components/tour/SchoolTour";

export const metadata: Metadata = {
  title: "School tour",
  description: "Walk through a 3D school and meet the principal, administrator, teacher, student and parent who use Fabric every day.",
  // Not indexed until the owner approves swapping it in at "/".
  robots: { index: false, follow: false },
};

export default function TourPage() {
  // Fallback MP4s are optional (rendered by `pnpm tour:render`); only offer the ones that exist.
  const videos = TOUR_ROLES.filter((r) => existsSync(path.join(process.cwd(), "public", "tour", `${r.key}.mp4`))).map((r) => r.key);
  return <SchoolTour videos={videos} />;
}
