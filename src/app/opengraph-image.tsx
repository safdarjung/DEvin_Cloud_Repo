import { ImageResponse } from "next/og";

export const alt = "Fabric — Intelligence That Moves Institutions Forward";
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
          background: "#0b1020",
          color: "#ffffff",
        }}
      >
        <div style={{ fontSize: 40, opacity: 0.7 }}>Fabric</div>
        <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.1, marginTop: 24 }}>
          Intelligence That Moves Institutions Forward
        </div>
        <div style={{ fontSize: 30, opacity: 0.7, marginTop: 32 }}>
          The operating system for budget-conscious private schools
        </div>
      </div>
    ),
    size,
  );
}
