import type { Metadata } from "next";
import { Home } from "@/components/home/Home";

// Fabric Vision: the "Storybook loom" landing (yarn tangle woven into cloth), kept as its own page.
export const metadata: Metadata = {
  title: "Fabric Vision",
  description: "Fabric, the institution operating system: every loose thread of running a school, woven into one system.",
  robots: { index: false },
};

export default function FabricVisionPage() {
  return <Home />;
}
