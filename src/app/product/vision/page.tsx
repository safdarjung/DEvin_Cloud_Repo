import { permanentRedirect } from "next/navigation";

// Fabric Vision became the home page (owner, 2026-11-14); keep shared /product/vision links working.
export default function FabricVisionPage() {
  permanentRedirect("/");
}
