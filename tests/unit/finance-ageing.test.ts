import { describe, expect, test } from "vitest";
import { AGEING_BUCKETS, ageingBucketsPaise } from "@/modules/finance/queries";

describe("ageingBucketsPaise", () => {
  test("puts outstanding rupees into day-late buckets as paise", () => {
    const rows = [
      { dueOn: "2026-11-20", outstanding: 100 }, // not yet due
      { dueOn: null, outstanding: 50.5 }, // no due date: not yet due
      { dueOn: "2026-11-17", outstanding: 1 }, // due today: not late
      { dueOn: "2026-11-16", outstanding: 2 }, // 1 day
      { dueOn: "2026-10-18", outstanding: 3 }, // 30 days
      { dueOn: "2026-10-11", outstanding: 30500 }, // 37 days
      { dueOn: "2026-08-19", outstanding: 4 }, // 90 days
      { dueOn: "2026-04-11", outstanding: 0.1 }, // over 90
    ];

    expect(ageingBucketsPaise(rows, "2026-11-17")).toEqual([15150, 500, 3050000, 400, 10]);
  });

  test("sums crore-sized totals exactly in paise", () => {
    const rows = Array.from({ length: 1645 }, () => ({ dueOn: "2026-10-11", outstanding: 17846.07 }));
    const paise = ageingBucketsPaise(rows, "2026-11-17");
    expect(paise[2]).toBe(1645 * 1784607);
    expect(paise).toHaveLength(AGEING_BUCKETS.length);
  });
});
