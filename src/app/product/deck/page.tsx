import type { Metadata } from "next";
import Deck from "@/components/present/Deck";

export const metadata: Metadata = {
  title: "Presentation",
  description: "Fabric, the school operating system, from the problem to a live demo.",
  robots: { index: false },
};

export default function PresentPage() {
  return <Deck />;
}
