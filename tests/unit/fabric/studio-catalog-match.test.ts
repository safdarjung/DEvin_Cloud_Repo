// U2 — deterministic "may already exist" match of a studio request against
// the module catalog (no AI). Fixed module list, not the live catalog.
import { describe, expect, it } from "vitest";
import { catalogMatches } from "@/modules/fabric/studio.queries";

const MODULES = [
  { key: "transport", label: "Transport", description: "Transport routes, vehicle allocation, and student tracking.", enabled: false },
  { key: "library", label: "Library", description: "Book catalogue with accession numbers, issue, renew and return, overdue list, and fines.", enabled: true },
  { key: "finance_plus", label: "Finance+", description: "Payment reversals, reminders, and collection reporting.", enabled: true },
  { key: "hostel", label: "Hostel", description: "Hostel rooms, bed allocations and nightly roll calls.", enabled: false },
];

describe("catalogMatches", () => {
  it("matches a module whose label appears in the request", () => {
    const result = catalogMatches({ title: "Bus tracking", problem: "Parents ask where the transport is", desiredOutcome: "Live view" }, MODULES);
    expect(result.map((m) => m.key)).toEqual(["transport"]);
  });

  it("matches on two shared description words, case- and plural-insensitive", () => {
    const result = catalogMatches(
      { title: "Overdue book fine", problem: "We track overdue books on paper", desiredOutcome: "Fine added automatically" },
      MODULES,
    );
    expect(result.map((m) => m.key)).toEqual(["library"]);
  });

  it("ranks stronger matches first and returns at most 3", () => {
    const result = catalogMatches(
      {
        title: "Hostel transport library finance+",
        problem: "hostel rooms, bed allocations, nightly roll calls; also transport, library and payments",
        desiredOutcome: "one place",
      },
      MODULES,
    );
    expect(result).toHaveLength(3);
    expect(result[0]!.key).toBe("hostel");
  });

  it("returns nothing for an unrelated request", () => {
    expect(catalogMatches({ title: "Robotics lab", problem: "Kits go missing", desiredOutcome: "Sign-out sheet" }, MODULES)).toEqual([]);
  });
});
