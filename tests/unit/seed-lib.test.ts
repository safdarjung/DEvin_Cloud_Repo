import { describe, expect, it } from "vitest";
import { insertBatch } from "../../scripts/seed/lib/batch";
import { uuidV5 } from "../../scripts/seed/lib/ids";
import { mulberry32 } from "../../scripts/seed/lib/prng";

describe("mulberry32", () => {
  it("is deterministic for the same seed", () => {
    const a = mulberry32(20261028);
    const b = mulberry32(20261028);
    const sequenceA = Array.from({ length: 5 }, () => a());
    const sequenceB = Array.from({ length: 5 }, () => b());
    expect(sequenceA).toEqual(sequenceB);
  });

  it("produces values in [0, 1)", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("differs for a different seed", () => {
    const a = mulberry32(1)();
    const b = mulberry32(2)();
    expect(a).not.toBe(b);
  });
});

describe("uuidV5", () => {
  it("is stable for the same section + natural key", () => {
    expect(uuidV5("core", "st-josephs-demo")).toBe(uuidV5("core", "st-josephs-demo"));
  });

  it("differs for a different natural key or section", () => {
    const base = uuidV5("core", "st-josephs-demo");
    expect(uuidV5("core", "other-school")).not.toBe(base);
    expect(uuidV5("people", "st-josephs-demo")).not.toBe(base);
  });

  it("produces a well-formed v5 UUID", () => {
    const id = uuidV5("core", "st-josephs-demo");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("insertBatch", () => {
  function fakeAdmin() {
    const inserted: unknown[][] = [];
    return {
      client: {
        from: () => ({
          insert: async (rows: unknown[]) => {
            inserted.push(rows);
            return { error: null };
          },
        }),
      },
      inserted,
    };
  }

  it("splits rows into chunks of the given batch size", async () => {
    const { client, inserted } = fakeAdmin();
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }));

    const count = await insertBatch(client as never, "table", rows, 1000);

    expect(count).toBe(2500);
    expect(inserted).toHaveLength(3);
    expect(inserted[0]).toHaveLength(1000);
    expect(inserted[1]).toHaveLength(1000);
    expect(inserted[2]).toHaveLength(500);
  });

  it("throws with the table name and offset when a batch fails", async () => {
    const client = {
      from: () => ({
        insert: async () => ({ error: { message: "boom" } }),
      }),
    };

    await expect(insertBatch(client as never, "widgets", [{ id: 1 }])).rejects.toThrow(
      /insertBatch\(widgets\) failed at offset 0/,
    );
  });
});
