import { ImageResponse } from "next/og";
import { BRAND, TAGLINE } from "@/components/fabricos/content";
import { FabricMark, MARK_BG } from "@/components/fabricos/mark";
import { OG_IMAGE } from "@/components/fabricos/seo";

export const alt = OG_IMAGE.alt;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          backgroundColor: MARK_BG,
          backgroundImage:
            "radial-gradient(circle at 85% 15%, rgba(99,102,241,0.22), transparent 45%), radial-gradient(circle at 10% 95%, rgba(34,211,238,0.12), transparent 40%)",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <FabricMark size={64} />
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>{BRAND}</div>
        </div>
        <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.08, marginTop: 40, letterSpacing: -2, maxWidth: 1000 }}>
          {TAGLINE}
        </div>
        <div style={{ fontSize: 30, color: "rgba(255,255,255,0.68)", marginTop: 32, maxWidth: 960 }}>
          A configurable, AI-powered operating system for institutions.
        </div>
      </div>
    ),
    size,
  );
}
