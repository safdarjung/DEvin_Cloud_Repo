import { describe, expect, it } from "vitest";
import { InventoryItemCreateSchema, InventoryMovementSchema } from "../../src/modules/inventory/schemas";

const id = "11111111-1111-4111-8111-111111111111";

describe("inventory schemas", () => {
  it("accepts a valid item and trims the name", () => {
    const r = InventoryItemCreateSchema.parse({ name: "  Chalk  ", unit: "box", reorderLevel: 5 });
    expect(r.name).toBe("Chalk");
  });
  it("rejects negative reorder level and unknown keys", () => {
    expect(InventoryItemCreateSchema.safeParse({ name: "A", unit: "u", reorderLevel: -1 }).success).toBe(false);
    expect(InventoryItemCreateSchema.safeParse({ name: "A", unit: "u", reorderLevel: 1, x: 1 }).success).toBe(false);
  });
  it("requires a positive quantity for in/issue/return", () => {
    for (const kind of ["in", "issue", "return"] as const) {
      expect(InventoryMovementSchema.safeParse({ itemId: id, kind, quantity: 0 }).success).toBe(false);
      expect(InventoryMovementSchema.safeParse({ itemId: id, kind, quantity: -2 }).success).toBe(false);
      expect(InventoryMovementSchema.safeParse({ itemId: id, kind, quantity: 2 }).success).toBe(true);
    }
  });
  it("allows signed non-zero adjust, refuses zero", () => {
    expect(InventoryMovementSchema.safeParse({ itemId: id, kind: "adjust", quantity: -3 }).success).toBe(true);
    expect(InventoryMovementSchema.safeParse({ itemId: id, kind: "adjust", quantity: 0 }).success).toBe(false);
  });
  it("rejects an unknown kind", () => {
    expect(InventoryMovementSchema.safeParse({ itemId: id, kind: "steal", quantity: 1 }).success).toBe(false);
  });
});
