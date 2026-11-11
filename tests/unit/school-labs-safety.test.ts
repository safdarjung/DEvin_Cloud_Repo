import { describe, expect, it } from "vitest";
import { expiryText, labSafetyWarnings, type SafetyEquipment } from "../../src/modules/school-labs/safety";

const item = (o: Partial<SafetyEquipment>): SafetyEquipment => ({ id: "1", name: "Item", kind: "chemical", quantity: 10, unit: "ml", hazardClass: null, expiryOn: null, ...o });
const TODAY = "2026-11-11";

describe("labSafetyWarnings", () => {
  it("returns nothing for a clean register", () => {
    expect(labSafetyWarnings([item({}), item({ id: "2", expiryOn: "2026-12-01" })], TODAY)).toEqual([]);
  });
  it("flags an expired item with how long ago", () => {
    const [w] = labSafetyWarnings([item({ name: "Litmus", expiryOn: "2026-11-08" })], TODAY);
    expect(w.reasons).toEqual(["expired"]);
    expect(w.text).toBe("Litmus: expired 3 days ago.");
  });
  it("does not flag an item expiring today", () => {
    expect(labSafetyWarnings([item({ expiryOn: TODAY })], TODAY)).toEqual([]);
  });
  it("flags hazard-classed items and zero quantity, combining reasons in one line", () => {
    const [w] = labSafetyWarnings([item({ name: "HCl", hazardClass: "corrosive", quantity: 0, expiryOn: "2026-11-10" })], TODAY);
    expect(w.reasons).toEqual(["expired", "hazard", "out_of_stock"]);
    expect(w.text).toBe("HCl: expired 1 day ago; hazard class corrosive; none left.");
  });
  it("does not flag low but non-zero stock", () => {
    expect(labSafetyWarnings([item({ quantity: 1 })], TODAY)).toEqual([]);
  });
});

describe("expiryText", () => {
  it("words each case", () => {
    expect(expiryText(null, TODAY)).toBe("");
    expect(expiryText("2026-11-10", TODAY)).toBe("Expired");
    expect(expiryText(TODAY, TODAY)).toBe("Expires today");
    expect(expiryText("2026-11-12", TODAY)).toBe("Expires in 1 day");
    expect(expiryText("2026-12-11", TODAY)).toBe("Expires in 30 days");
  });
});
