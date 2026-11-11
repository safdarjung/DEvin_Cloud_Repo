import { describe, expect, test } from "vitest";
import { checkUploadFile, formatBytes } from "../../src/modules/documents/upload-check";

describe("checkUploadFile", () => {
  test("accepts a small pdf", () => expect(checkUploadFile({ type: "application/pdf", size: 1000 })).toBeNull());
  test("rejects other mime types", () => expect(checkUploadFile({ type: "text/html", size: 10 })).toMatch(/PDF/));
  test("rejects empty and oversize files", () => {
    expect(checkUploadFile({ type: "image/png", size: 0 })).toMatch(/empty/);
    expect(checkUploadFile({ type: "image/png", size: 10485761 })).toMatch(/10 MB/);
  });
  test("formats sizes", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5242880)).toBe("5.0 MB");
  });
});
