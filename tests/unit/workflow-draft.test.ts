// AI workflow drafter: the model writes a closed frame (catalog keys as
// enums); toWorkflowDraft rejects anything outside the catalog, the school's
// real sections or its agents, then validates the whole workflow with the
// module's own form validator, graph parser and save schema.
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { toWorkflowDraft, workflowDraftGenerationSchema, type WorkflowDraftOptions } from "@/modules/ai/workflow-drafts";

const SECTION_XA = "11111111-2222-4333-8444-555555555555";
const CUSTOM = `custom_${"b".repeat(32)}`;
const OPTS: WorkflowDraftOptions = {
  sections: [
    { id: SECTION_XA, label: "X-A" },
    { id: "22222222-2222-4333-8444-555555555555", label: "X-B" },
  ],
  agents: [
    { slug: "attendance", name: "Attendance agent" },
    { slug: CUSTOM, name: "Late-comer follow-up" },
  ],
};

const blankStep = {
  type: "check_number",
  label: "",
  metric: "",
  comparison: "",
  value: 0,
  section: "",
  roles: [] as string[],
  message: "",
  question: "",
  agent: "",
  task: "",
};

// What a model returns for the owner's request "number of absent students in class X A".
const ownerExample = {
  name: "Absent students in X-A",
  trigger: { kind: "manual", frequency: "none", weekday: 1, time: "", event: "" },
  steps: [{ ...blankStep, label: "Absent today in X-A", metric: "attendance.section_absent_today", comparison: "gte", value: 0, section: "X-A" }],
};

describe("toWorkflowDraft", () => {
  test("the owner's example becomes a by-hand workflow measuring today's absences in X-A", () => {
    const draft = toWorkflowDraft(ownerExample, OPTS);
    expect(draft).toEqual({
      ok: true,
      name: "Absent students in X-A",
      form: {
        trigger: { label: "Run by hand", config: { kind: "manual" } },
        steps: [
          {
            type: "condition",
            label: "Absent today in X-A",
            config: { metric: "attendance.section_absent_today", op: "gte", value: "0", section: SECTION_XA },
          },
        ],
      },
    });
  });

  test("schedule, notify, approval and a custom agent map onto the form", () => {
    const draft = toWorkflowDraft(
      {
        name: "Daily absence alert",
        trigger: { kind: "schedule", frequency: "mon_sat", weekday: 1, time: "10:00", event: "" },
        steps: [
          { ...ownerExample.steps[0]!, comparison: "gte", value: 5 },
          { ...blankStep, type: "notify", label: "Tell the principal", roles: ["principal"], message: "{count} absent in X-A today." },
          { ...blankStep, type: "approval", label: "Follow up?", question: "Ask the agent to follow up?" },
          { ...blankStep, type: "ask_agent", label: "Follow up", agent: CUSTOM, task: "Draft a note to the class teacher." },
        ],
      },
      OPTS,
    );
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.form.trigger.config).toEqual({ kind: "schedule", cron: "0 10 * * 1-6" });
    expect(draft.form.steps.map((s) => s.type)).toEqual(["condition", "notify", "approval", "agent"]);
    expect(draft.form.steps[1]!.config).toEqual({ audience: "roles", roles: "principal", message: "{count} absent in X-A today." });
    expect(draft.form.steps[3]!.config).toEqual({ agent: CUSTOM, task: "Draft a note to the class teacher." });
  });

  test.each([
    ["an unknown metric", { steps: [{ ...ownerExample.steps[0]!, metric: "students.total" }] }],
    ["a section the school does not have", { steps: [{ ...ownerExample.steps[0]!, section: "IX-Z" }] }],
    ["a section id instead of a label", { steps: [{ ...ownerExample.steps[0]!, section: SECTION_XA }] }],
    ["an unknown role", { steps: [{ ...blankStep, type: "notify", label: "Tell", roles: ["parents"], message: "Hi" }] }],
    ["an unknown agent", { steps: [{ ...blankStep, type: "ask_agent", label: "Ask", agent: "hr_bot", task: "Do it" }] }],
    ["an unknown step type", { steps: [{ ...blankStep, type: "send_sms" }] }],
    ["an unknown event", { trigger: { kind: "event", frequency: "none", weekday: 1, time: "", event: "student.birthday" } }],
    ["a schedule with no frequency", { trigger: { kind: "schedule", frequency: "none", weekday: 1, time: "10:00", event: "" } }],
    ["a schedule time that is not HH:MM", { trigger: { kind: "schedule", frequency: "daily", weekday: 1, time: "25:00", event: "" } }],
    ["zero steps", { steps: [] }],
    ["a check with no metric", { steps: [{ ...blankStep, label: "Check" }] }],
  ])("rejects %s", (_, patch) => {
    expect(toWorkflowDraft({ ...ownerExample, ...patch }, OPTS)).toEqual({ ok: false });
  });

  test("a section metric on an event-only metric's trigger rule still goes through the graph validator", () => {
    // attendance.session_absences needs the absences-submitted event trigger.
    const bad = { ...ownerExample, steps: [{ ...ownerExample.steps[0]!, metric: "attendance.session_absences", section: "" }] };
    expect(toWorkflowDraft(bad, OPTS)).toEqual({ ok: false });
  });
});

describe("workflowDraftGenerationSchema", () => {
  test("gives the model the catalog, the school's sections and agents as closed sets", () => {
    const schema = workflowDraftGenerationSchema(OPTS);
    expect(schema.safeParse(ownerExample).success).toBe(true);
    expect(schema.safeParse({ ...ownerExample, steps: [{ ...ownerExample.steps[0]!, section: "IX-Z" }] }).success).toBe(false);
    expect(schema.safeParse({ ...ownerExample, steps: [{ ...blankStep, type: "ask_agent", agent: "hr_bot" }] }).success).toBe(false);
  });

  test("has no regex pattern (Ollama cannot compile a JSON-schema pattern into its format grammar)", () => {
    expect(JSON.stringify(z.toJSONSchema(workflowDraftGenerationSchema(OPTS)))).not.toContain('"pattern"');
  });

  test("works for a school with no sections and no agents", () => {
    const schema = workflowDraftGenerationSchema({ sections: [], agents: [] });
    expect(schema.safeParse({ ...ownerExample, steps: [{ ...ownerExample.steps[0]!, section: "" }] }).success).toBe(true);
    expect(toWorkflowDraft(ownerExample, { sections: [], agents: [] })).toEqual({ ok: false });
  });
});
