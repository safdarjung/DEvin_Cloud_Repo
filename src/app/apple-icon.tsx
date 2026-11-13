import { ImageResponse } from "next/og";
import { FabricMark, MARK_BG } from "@/components/fabricos/mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: MARK_BG,
        }}
      >
        <FabricMark size={128} />
      </div>
    ),
    size,
  );
}
