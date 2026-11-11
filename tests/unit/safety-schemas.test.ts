import { describe, expect, it } from "vitest";
import { AlertAudienceSchema, AlertIdSchema, AlertListSchema, AlertSendSchema, HeadcountSchema } from "../../src/modules/safety/schemas.ts";
import { NOTIFICATION_TEMPLATES, NOTIFICATION_TYPES } from "../../src/modules/notifications/templates.ts";

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const send = { kind: "drill", title: "Fire drill", message: "Walk to the assembly ground.", audience: "all" } as const;

describe("safety schemas", () => {
  it("accepts every kind and the all/staff audiences without sections", () => {
    for (const kind of ["emergency", "drill", "closure"] as const) expect(AlertSendSchema.safeParse({ ...send, kind }).success).toBe(true);
    expect(AlertSendSchema.safeParse({ ...send, audience: "staff" }).success).toBe(true);
  });

  it("sections audience needs 1-200 distinct sections; other audiences take none", () => {
    expect(AlertSendSchema.safeParse({ ...send, audience: "sections", sectionIds: [a, b] }).success).toBe(true);
    expect(AlertSendSchema.safeParse({ ...send, audience: "sections" }).success).toBe(false);
    expect(AlertSendSchema.safeParse({ ...send, audience: "sections", sectionIds: [] }).success).toBe(false);
    expect(AlertSendSchema.safeParse({ ...send, audience: "sections", sectionIds: [a, a] }).success).toBe(false);
    expect(AlertSendSchema.safeParse({ ...send, audience: "all", sectionIds: [a] }).success).toBe(false);
    expect(AlertAudienceSchema.safeParse({ audience: "sections", sectionIds: [a] }).success).toBe(true);
    expect(AlertAudienceSchema.safeParse({ audience: "staff", sectionIds: [a] }).success).toBe(false);
  });

  it("rejects bad kind, blank or long text, extra keys", () => {
    expect(AlertSendSchema.safeParse({ ...send, kind: "test" }).success).toBe(false);
    expect(AlertSendSchema.safeParse({ ...send, title: "   " }).success).toBe(false);
    expect(AlertSendSchema.safeParse({ ...send, title: "t".repeat(201) }).success).toBe(false);
    expect(AlertSendSchema.safeParse({ ...send, message: "m".repeat(1001) }).success).toBe(false);
    expect(AlertSendSchema.safeParse({ ...send, createdBy: a }).success).toBe(false);
  });

  it("headcount counts are integers 0-1000 and the note is at most 200 chars", () => {
    const hc = { alertId: a, classSectionId: b, presentCount: 40, missingCount: 0 };
    expect(HeadcountSchema.safeParse(hc).success).toBe(true);
    expect(HeadcountSchema.safeParse({ ...hc, note: "One at sick bay" }).success).toBe(true);
    expect(HeadcountSchema.safeParse({ ...hc, presentCount: -1 }).success).toBe(false);
    expect(HeadcountSchema.safeParse({ ...hc, missingCount: 1001 }).success).toBe(false);
    expect(HeadcountSchema.safeParse({ ...hc, presentCount: 1.5 }).success).toBe(false);
    expect(HeadcountSchema.safeParse({ ...hc, note: "n".repeat(201) }).success).toBe(false);
  });

  it("id and list schemas are strict", () => {
    expect(AlertIdSchema.safeParse({ alertId: a }).success).toBe(true);
    expect(AlertIdSchema.safeParse({ alertId: "x" }).success).toBe(false);
    expect(AlertListSchema.safeParse({ page: 2 }).success).toBe(true);
    expect(AlertListSchema.safeParse({ page: 0 }).success).toBe(false);
  });
});

describe("safety_alert notification template", () => {
  it("is registered, in-app + sms only, and renders kind, title, message and school", () => {
    expect(NOTIFICATION_TYPES).toContain("safety_alert");
    const t = NOTIFICATION_TEMPLATES.safety_alert;
    expect(t.channels).toEqual(["in_app", "sms"]);
    const vars = { kind: "drill" as const, title: "Fire drill", message: "Walk to the assembly ground.", school: "St. Joseph" };
    const en = t.body(vars, "en");
    expect(en).toContain("DRILL");
    expect(en).toContain(vars.title);
    expect(en).toContain(vars.message);
    expect(en).toContain(vars.school);
    expect(t.body({ ...vars, kind: "emergency" }, "en")).toContain("EMERGENCY");
    expect(t.body(vars, "hi")).toContain(vars.message);
  });

  it("rejects free-form extra variables and an unknown kind", () => {
    const { varsSchema } = NOTIFICATION_TEMPLATES.safety_alert;
    const vars = { kind: "closure", title: "Closed", message: "Rain.", school: "S" };
    expect(varsSchema.safeParse(vars).success).toBe(true);
    expect(varsSchema.safeParse({ ...vars, extra: "x" }).success).toBe(false);
    expect(varsSchema.safeParse({ ...vars, kind: "party" }).success).toBe(false);
  });
});
