import { describe, expect, test } from "vitest";
import { formatINRCompact } from "@/components/chart";

describe("formatINRCompact", () => {
  test("formats crore, lakh, thousand and zero boundaries", () => {
    expect(formatINRCompact(13500000)).toBe("₹1.35 Cr");
    expect(formatINRCompact(10000000)).toBe("₹1 Cr");
    expect(formatINRCompact(4500000)).toBe("₹45 L");
    expect(formatINRCompact(100000)).toBe("₹1 L");
    expect(formatINRCompact(12500)).toBe("₹12.5K");
    expect(formatINRCompact(1000)).toBe("₹1K");
    expect(formatINRCompact(999)).toBe("₹999");
    expect(formatINRCompact(0)).toBe("₹0");
  });
});
