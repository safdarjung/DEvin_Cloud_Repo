// M15-T6 — rowsToCsvText (src/lib/http/csv-text.ts) and the report source
// registry / runner (src/modules/reports/sources.ts). No DB: runReportSource
// is exercised against a fake Supabase client stub.
import { describe, expect, it, vi } from "vitest";
import { rowsToCsvText } from "@/lib/http/csv-text";
import { REPORT_SOURCES, runReportSource } from "@/modules/reports/sources";

describe("rowsToCsvText (M15-T6)", () => {
  it("escapes a formula-leading cell to prevent CSV injection", () => {
    expect(rowsToCsvText([{ note: "=SUM(A1)" }])).toContain("'=SUM(A1)");
  });

  it("0 rows + columns -> header-only CSV", () => {
    expect(rowsToCsvText([], ["date", "grade"])).toBe("date,grade");
  });

  it("0 rows, no columns -> empty string", () => {
    expect(rowsToCsvText([])).toBe("");
  });

  it("column order follows `columns`, independent of row key order", () => {
    const text = rowsToCsvText([{ b: "2", a: "1" }], ["a", "b"]);
    expect(text).toBe("a,b\r\n1,2");
  });
});

describe("REPORT_SOURCES (M15-T6)", () => {
  it("has exactly the two allowlisted sources", () => {
    expect(Object.keys(REPORT_SOURCES).sort()).toEqual(["attendance.daily", "finance.defaulters"]);
  });
});

describe("runReportSource (M15-T6)", () => {
  function fakeClient(result: { data?: unknown; error?: unknown }) {
    return { rpc: vi.fn().mockResolvedValue(result) } as unknown as {
      rpc: ReturnType<typeof vi.fn>;
    };
  }

  it("calls rpc with p_institution_id, p_as_of, and the source's own args", async () => {
    const client = fakeClient({ data: [{ date: "2026-11-04" }], error: null });

    const rows = await runReportSource(
      client as never,
      "attendance.daily",
      "inst-1",
      { dayOffset: -1 },
      "2026-11-04T00:00:00Z",
    );

    expect(client.rpc).toHaveBeenCalledWith("report_attendance_daily", {
      p_institution_id: "inst-1",
      p_as_of: "2026-11-04T00:00:00Z",
      p_day_offset: -1,
    });
    expect(rows).toEqual([{ date: "2026-11-04" }]);
  });

  it("bad params throws before rpc is called", async () => {
    const client = fakeClient({ data: [], error: null });

    await expect(
      runReportSource(client as never, "attendance.daily", "inst-1", { dayOffset: -2 }, "2026-11-04T00:00:00Z"),
    ).rejects.toBeDefined();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rpc error throws", async () => {
    const client = fakeClient({ data: null, error: new Error("boom") });

    await expect(
      runReportSource(client as never, "finance.defaulters", "inst-1", {}, "2026-11-04T00:00:00Z"),
    ).rejects.toThrow("boom");
  });

  it("unknown key throws", async () => {
    const client = fakeClient({ data: [], error: null });

    await expect(
      runReportSource(client as never, "not.a.source" as never, "inst-1", {}, "2026-11-04T00:00:00Z"),
    ).rejects.toThrow();
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
