// The FabricOS logo is the App Orb: the same honeycomb net (orbNet, compact density) drawn flat.
// `near` is the half of the sphere facing the viewer, `far` the half seen through it.
// Coordinates fit a `-50 -50 100 100` viewBox.
import { netPaths, orbNet } from "@/modules/ai/components/orb/orb-layout";

export const ORB_MARK_VIEWBOX = "-50 -50 100 100";
export const ORB_MARK = netPaths(orbNet(2), 0.1, -0.5, 43);
