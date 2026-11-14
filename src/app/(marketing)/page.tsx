import { homeMetadata } from "@/components/fabricos/seo";
import { Home } from "@/components/home/Home";

// The home page is Fabric Vision, the loom story (owner, 2026-11-14). The long product page with the
// section anchors is the overview at /product/overview.
export const metadata = homeMetadata;

export default function HomePage() {
  return <Home />;
}
