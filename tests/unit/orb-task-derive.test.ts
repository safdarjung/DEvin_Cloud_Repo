import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ActionMeta } from "@/lib/actions/registry";
import {
  MODULE_GROUP,
  actionJsonSchema,
  classify,
  deriveFieldKind,
  deriveMode,
  deriveRisk,
  groupFor,
  rule6Family,
  schemaFields,
} from "@/modules/ai/tasks/derive";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

let meta: ReadonlyMap<string, ActionMeta>;

beforeAll(async () => {
  await import("@/app/api/v1/actions/all-actions");
  meta = (await import("@/lib/actions/registry")).getActionMeta();
}, 30_000);

function real(name: string): ActionMeta {
  const m = meta.get(name);
  if (!m) throw new Error(`${name} is not registered`);
  return m;
}

function kindAt(name: string, fieldPath: string) {
  const m = real(name);
  const field = schemaFields(actionJsonSchema(m)).find((f) => f.path === fieldPath);
  if (!field) throw new Error(`${name} has no ${fieldPath}`);
  return deriveFieldKind(m.module, field);
}

const noArrays = { type: "object", properties: {} };

describe("risk by verb", () => {
  it("destructive, publishing and sending verbs need human approval", () => {
    for (const name of ["finance.payment.void", "resource.delete", "announcement.publish", "finance.reminders.send", "admissions.application.decide", "maintenance.close"]) {
      expect(deriveRisk(name, noArrays), name).toBe("human_approved");
    }
  });

  it("acknowledge, join, leave, log and toggle are low-risk and reversible", () => {
    for (const name of ["diary.acknowledge", "clubs.join", "clubs.leave", "study.session.log", "study.plan.toggleItem"]) {
      expect(deriveRisk(name, noArrays), name).toBe("low_risk_reversible");
    }
  });

  it("everything else is confirmed by the user", () => {
    expect(deriveRisk("library.loan.issue", noArrays)).toBe("user_confirmed");
  });

  it("an array of 50 or more items needs human approval", () => {
    expect(deriveRisk("attendance.markPeriod", actionJsonSchema(real("attendance.markPeriod")))).toBe("human_approved");
    expect(deriveRisk("study.plan.save", actionJsonSchema(real("study.plan.save")))).toBe("user_confirmed");
  });

  it("classify takes the agents' ACTION_RISK before the verb rule, and a row before both", () => {
    expect(classify("library.loan.renew", real("library.loan.renew"), { label: "Renew" }).risk).toBe("low_risk_reversible");
    expect(classify("library.loan.renew", real("library.loan.renew"), { label: "Renew", risk: "human_approved" }).risk).toBe("human_approved");
  });
});

describe("mode rules", () => {
  const mode = (name: string) => deriveMode(name, real(name).module, actionJsonSchema(real(name)));

  it("student study is learn; teaching modules are teach", () => {
    expect(mode("study.plan.save")).toBe("learn");
    expect(mode("assignment.publish")).toBe("teach");
    expect(mode("study.teacher.assign")).toBe("teach");
    expect(mode("curriculum.material.attach")).toBe("teach");
  });

  it("setup entities are manage", () => {
    expect(mode("ptm.slots.add")).toBe("manage");
    expect(mode("expenses.category.create")).toBe("manage");
    expect(mode("finance.structure.upsert")).toBe("manage");
  });

  it("creating something with a body, content or description is create", () => {
    expect(mode("announcement.create")).toBe("create");
    expect(mode("assignment.create")).toBe("create");
    expect(mode("curriculum.lessonPlan.upsert")).toBe("create");
  });

  it("everything else is do", () => {
    expect(mode("attendance.mark")).toBe("do");
    expect(mode("diary.entry.post")).toBe("do");
    expect(mode("library.loan.issue")).toBe("do");
  });
});

describe("field kinds (design C2: money is not detectable from the Zod type)", () => {
  it("finance takes rupee decimals", () => {
    expect(kindAt("finance.payment.record", "/amount")).toBe("rupees");
  });

  it("canteen takes integer paise", () => {
    expect(kindAt("canteen.topup", "/amountPaise")).toBe("paise");
  });

  it("expenses take rupee text", () => {
    expect(kindAt("expenses.record", "/amount")).toBe("rupee_text");
  });

  it("exam marks are marks although they reuse the money schema", () => {
    expect(kindAt("exam.marks.enter", "/marks/*/marksObtained")).toBe("marks");
    expect(kindAt("exam.recheck.decide", "/newMarks")).toBe("marks");
  });

  it("a question's mark weight is a plain number", () => {
    expect(kindAt("questionBank.create", "/marks")).toBe("number");
  });

  it("idempotency keys are generated, untyped *At fields are datetimes, uuids are entities", () => {
    expect(kindAt("finance.payment.record", "/idempotencyKey")).toBe("generated");
    expect(kindAt("finance.payment.record", "/receivedAt")).toBe("datetime");
    expect(kindAt("finance.payment.record", "/invoiceId")).toBe("entity");
    expect(kindAt("library.loan.issue", "/accessionNo")).toBe("natural_key");
    expect(kindAt("ptm.slots.add", "/from")).toBe("time");
    expect(kindAt("study.plan.save", "/targetDate")).toBe("date");
  });

  it("colliding field names resolve by module", () => {
    expect(classify("maintenance.assign", real("maintenance.assign"), { label: "x" }).entities["/requestId"]).toBe("facilities.maintenanceRequest");
    expect(classify("ptm.slots.add", real("ptm.slots.add"), { label: "x" }).entities["/eventId"]).toBe("ptm.event");
    expect(classify("timetable.substitution.assign", real("timetable.substitution.assign"), { label: "x" }).entities["/slotId"]).toBe("timetable.slot");
    expect(classify("ptm.booking.create", real("ptm.booking.create"), { label: "x" }).entities["/slotId"]).toBe("ptm.slot");
  });

  it("union branches merge into one path", () => {
    const paths = schemaFields(actionJsonSchema(real("announcement.create"))).map((f) => f.path);
    expect(paths).toContain("/audiences/*/gradeId");
    expect(paths).toContain("/audiences/*/classSectionId");
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("rule-6 families", () => {
  it("seeds from DRAFT_DENY without its false positives", () => {
    expect(rule6Family("exam.marks.enter")).toBe("marks");
    expect(rule6Family("exam.result.publish")).toBe("marks");
    expect(rule6Family("finance.payment.record")).toBe("money");
    expect(rule6Family("library.loan.return")).toBe("money");
    expect(rule6Family("core.member.setRole")).toBe("access");
    expect(rule6Family("admissions.application.decide")).toBe("access");
    expect(rule6Family("health.visit.add")).toBe("welfare");
    expect(rule6Family("attendance.mark")).toBeUndefined();
    expect(rule6Family("exam.remark.save")).toBeUndefined();
    expect(rule6Family("library.loan.renew")).toBeUndefined();
  });
});

describe("groups", () => {
  it("maps modules to orb groups, unknown modules to more", () => {
    expect(groupFor("fees")).toBe("finance");
    expect(groupFor("substitution")).toBe("operations");
    expect(groupFor("core")).toBe("more");
    expect(groupFor(undefined)).toBe("more");
  });

  it("mirrors MODULE_GROUP in orb-groups.ts exactly", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/modules/ai/components/orb/orb-groups.ts"), "utf8");
    const block = /const MODULE_GROUP[^=]*=\s*\{([\s\S]*?)\};/.exec(src)?.[1] ?? "";
    const orb = Object.fromEntries([...block.matchAll(/(\w+):\s*"(\w+)"/g)].map((m) => [m[1], m[2]]));
    expect(Object.keys(orb).length).toBeGreaterThan(20);
    expect({ ...MODULE_GROUP }).toEqual(orb);
  });
});

describe("classify", () => {
  it("merges derived defaults with the hand-written row", () => {
    const schema = z.object({ studentId: z.string().uuid(), idempotencyKey: z.string().uuid(), amount: z.number().multipleOf(0.01) }).strict();
    const m = { schema, permission: "finance.payment.record", module: "fees" } as ActionMeta;
    const task = classify("finance.payment.record", m, { label: "Record a fee payment", family: "money", humanOnly: ["/amount"], groupId: "people" });
    expect(task).toMatchObject({
      action: "finance.payment.record",
      label: "Record a fee payment",
      mode: "do",
      groupId: "people",
      risk: "user_confirmed",
      family: "money",
      humanOnly: ["/amount"],
      generated: ["/idempotencyKey"],
      entities: { "/studentId": "student" },
    });
  });
});
