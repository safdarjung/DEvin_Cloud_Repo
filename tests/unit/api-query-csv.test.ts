// M04-T7 — `?format=csv` support: toCsvResponse(result, name) wraps an
// already-computed ActionResult (what dispatchCall's Response.json() would
// give the route) into a CSV Response, or passes the JSON envelope through
// unchanged for errors / non-list results. No DB: pure function, mocked
// ActionResult inputs stand in for a real dispatch result.
import { describe, expect, it } from "vitest";
import { toCsvResponse } from "@/lib/http/csv";

describe("toCsvResponse (M04-T7)", () => {
  it("list result -> text/csv with header row, data, and export headers", async () => {
    const res = toCsvResponse(
      { ok: true, data: [{ id: "1", name: "Ann" }, { id: "2", name: "Bob" }] },
      "people.listStudents",
    );

    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="people.listStudents.csv"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.text()).resolves.toBe("id,name\r\n1,Ann\r\n2,Bob");
  });

  it("supports a { rows: [...] } result shape", async () => {
    const res = toCsvResponse({ ok: true, data: { rows: [{ id: "1" }] } }, "x");
    await expect(res.text()).resolves.toBe("id\r\n1");
  });

  it("supports a paginated page object with a single array field (e.g. people.listStudents)", async () => {
    const res = toCsvResponse(
      { ok: true, data: { students: [{ admissionNo: "ADM-1" }], total: 1, page: 1, pageSize: 50 } },
      "people.listStudents",
    );
    await expect(res.text()).resolves.toBe("admissionNo\r\nADM-1");
  });

  it("escapes a formula-leading cell to prevent CSV injection", async () => {
    const res = toCsvResponse({ ok: true, data: [{ note: "=SUM(A1)" }] }, "x");
    await expect(res.text()).resolves.toContain("'=SUM(A1)");
  });

  it("JSON-stringifies a nested value", async () => {
    const res = toCsvResponse({ ok: true, data: [{ tags: ["a", "b"] }] }, "x");
    await expect(res.text()).resolves.toContain('"[""a"",""b""]"');
  });

  it("non-list ok result -> 422 validation_failed", async () => {
    const res = toCsvResponse({ ok: true, data: { foo: "bar" } }, "x");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: { code: "validation_failed", message: "Query result is not exportable as CSV." } });
  });

  it("error result keeps the JSON envelope unchanged", async () => {
    const res = toCsvResponse({ ok: false, error: { code: "forbidden", message: "nope" } }, "x");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: { code: "forbidden", message: "nope" } });
  });
});
