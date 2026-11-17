import { describe, expect, it } from "vitest";
import { GUARDIAN_NAV, NAV_ITEMS, STUDENT_NAV } from "@/lib/nav";
import { buildTourSteps } from "@/lib/tour";
import { ROLE_INTRO, TOUR_COPY } from "@/lib/tour-copy";

describe("tour copy", () => {
  it("has text for every sidebar tab, so a new tab cannot ship without its tour step", () => {
    const missing = [...NAV_ITEMS, ...GUARDIAN_NAV, ...STUDENT_NAV].map((i) => i.href).filter((href) => !TOUR_COPY[href]);
    expect(missing).toEqual([]);
  });

  it("has an intro for every role", () => {
    expect(Object.values(ROLE_INTRO).every((t) => t.length > 20)).toBe(true);
  });
});

const copy = {
  "/dashboard": { text: "The school at a glance." },
  "/attendance": { text: "Attendance for every class.", teacher: "Mark your class register." },
  "/portal/fees": { text: "Fees.", guardian: "Your child's fees.", student: "Your fees." },
};
const items = [
  { href: "/demo-school/dashboard", label: "Dashboard", group: "Overview" },
  { href: "/demo-school/attendance", label: "Attendance", group: "Academics" },
];

describe("buildTourSteps", () => {
  it("turns each sidebar tab into a step in sidebar order, with that page's text", () => {
    const steps = buildTourSteps(items, "/demo-school", "principal", copy);
    expect(steps).toEqual([
      { href: "/demo-school/dashboard", title: "Dashboard", text: "The school at a glance.", group: "Overview" },
      { href: "/demo-school/attendance", title: "Attendance", text: "Attendance for every class.", group: "Academics" },
    ]);
  });

  it("uses the role's own wording when the page means something different to them", () => {
    expect(buildTourSteps(items, "/demo-school", "teacher", copy)[1].text).toBe("Mark your class register.");
    const fees = [{ href: "/demo-school/portal/fees", label: "Fees", group: "My child" }];
    expect(buildTourSteps(fees, "/demo-school", "guardian", copy)[0].text).toBe("Your child's fees.");
    expect(buildTourSteps(fees, "/demo-school", "student", copy)[0].text).toBe("Your fees.");
  });

  it("still shows a tab that has no text yet, so the tour never skips a page silently", () => {
    const steps = buildTourSteps([{ href: "/demo-school/new-thing", label: "New thing", group: "Admin" }], "/demo-school", "owner", copy);
    expect(steps[0].text).toBe("Open New thing to see what is here.");
  });
});
