import { ImageResponse } from "next/og";

// Ids: 192, 512 (any) and maskable (full-bleed, glyph inside the 80% safe zone).
export function generateImageMetadata() {
  return [
    { id: "192", size: { width: 192, height: 192 }, contentType: "image/png" },
    { id: "512", size: { width: 512, height: 512 }, contentType: "image/png" },
    { id: "maskable", size: { width: 512, height: 512 }, contentType: "image/png" },
  ];
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const which = String(await id);
  const size = which === "192" ? 192 : 512;
  const maskable = which === "maskable";
  const glyph = Math.round(size * (maskable ? 0.5 : 0.62));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b1020",
          borderRadius: maskable ? 0 : Math.round(size * 0.22),
          color: "#ffffff",
          fontSize: glyph,
          fontWeight: 700,
        }}
      >
        F
      </div>
    ),
    { width: size, height: size },
  );
}
