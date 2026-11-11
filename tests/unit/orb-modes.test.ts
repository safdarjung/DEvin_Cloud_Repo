import { describe, expect, it } from "vitest";
import type { CapabilityKey } from "@/modules/ai/capabilities/catalog";
import { orbChips } from "@/modules/ai/components/orb/orb-chips";
import { buildOrbFeatures, type OrbTaskInput } from "@/modules/ai/components/orb/orb-groups";
import {
  featureEffect, groupsFor, modesOf, parseOrbQuery, pickMode, searchFeatures, sectionForPath, type OrbFeature,
} from "@/modules/ai/components/orb/orb-modes";
import { orbUrl } from "@/components/ask-ai/suggestions";

// Fixtures: what the server would hand the orb page per role (enabled capabilities + listEnabledTasks rows).
const TEACHER_CAPS: CapabilityKey[] = ["attendance_overview", "exam_overview", "timetable_overview", "lesson_plan_draft", "generate_quiz"];
const TEACHER_TASKS: OrbTaskInput[] = [
  { action: "attendance.mark", label: "Mark the register", mode: "do", groupId: "attendance" },
  { action: "diary.entry.create", label: "Post a diary entry", mode: "do", groupId: "teaching" },
  { action: "assignment.publish", label: "Publish an assignment", mode: "teach", groupId: "teaching" },
  { action: "ptm.slot.create", label: "Open PTM slots", mode: "manage", groupId: "calendar" },
];
const STUDENT_CAPS: CapabilityKey[] = ["hints_first", "exam_prep", "study_visuals"];
const STUDENT_TASKS: OrbTaskInput[] = [
  { action: "study.plan.create", label: "Make a study plan", mode: "learn", groupId: "study" },
  { action: "clubs.member.join", label: "Join a club", mode: "do", groupId: "clubs" },
];
const PRINCIPAL_CAPS: CapabilityKey[] = ["attendance_overview", "finance_overview", "do_it_in_chat", "daily_briefing"];
const PRINCIPAL_TASKS: OrbTaskInput[] = [
  { action: "staff_leave.approve", label: "Approve staff leave", mode: "do", groupId: "people" },
  { action: "announcement.create", label: "Write an announcement", mode: "create", groupId: "calendar" },
];

const tree = (caps: CapabilityKey[], tasks: OrbTaskInput[], role: Parameters<typeof buildOrbFeatures>[2], apps: string[] = [], chatOn = true) =>
  buildOrbFeatures(orbChips(caps, { slug: "demo", appHrefs: apps, chatOn }), tasks, role, chatOn);

describe("feature tree per role", () => {
  it("teacher: Ask questions, Do/Teach/Manage tasks, Create drafting tools; no Learn tab", () => {
    const f = tree(TEACHER_CAPS, TEACHER_TASKS, "teacher");
    expect(modesOf(f)).toEqual(["ask", "do", "create", "teach", "manage"]);
    expect(groupsFor(f, "ask").map((g) => g.id)).toEqual(["attendance", "exams", "teaching", "timetable"]);
    expect(groupsFor(f, "do").map((g) => [g.id, g.features.map((x) => x.task)])).toEqual([
      ["attendance", ["attendance.mark"]],
      ["teaching", ["diary.entry.create"]],
    ]);
    expect(groupsFor(f, "create").flatMap((g) => g.features.map((x) => [x.key, x.kind]))).toEqual([
      ["lesson_plan_draft", "ask"],
      ["generate_quiz", "ask"],
    ]);
  });

  it("student: Learn and Do from tasks, Ask study questions, Create study visuals", () => {
    const f = tree(STUDENT_CAPS, STUDENT_TASKS, "student");
    expect(modesOf(f)).toEqual(["ask", "do", "create", "learn"]);
    expect(groupsFor(f, "learn")[0]).toMatchObject({ id: "study", features: [{ kind: "task", task: "study.plan.create", label: "Make a study plan" }] });
  });

  it("principal: a page tool is an 'open' link in Create; tasks land in their own mode and section", () => {
    const f = tree(PRINCIPAL_CAPS, PRINCIPAL_TASKS, "principal", ["/demo/dashboard"]);
    const briefing = f.find((x) => x.key === "daily_briefing");
    expect(briefing).toMatchObject({ kind: "open", mode: "create", href: "/demo/dashboard" });
    expect(groupsFor(f, "create").find((g) => g.id === "calendar")?.features.map((x) => x.task ?? x.key)).toEqual(["do_it_in_chat", "announcement.create"]);
  });

  it("a mode with nothing in it is hidden; with no tasks only Ask and Create remain", () => {
    expect(modesOf(tree(TEACHER_CAPS, [], "teacher"))).toEqual(["ask", "create"]);
    expect(modesOf([])).toEqual([]);
    expect(groupsFor(tree(TEACHER_CAPS, [], "teacher"), "do")).toEqual([]);
  });

  it("a task appears only when the server listed it as enabled", () => {
    const f = tree(TEACHER_CAPS, TEACHER_TASKS.slice(0, 1), "teacher");
    expect(f.filter((x) => x.kind === "task").map((x) => x.task)).toEqual(["attendance.mark"]);
  });

  it("with chat off, nothing that sends a message survives: page links and tasks only", () => {
    const f = tree(["question_paper_builder", "attendance_overview"], TEACHER_TASKS.slice(0, 1), "teacher", ["/demo/question-bank"], false);
    expect(f.map((x) => x.kind).sort()).toEqual(["open", "task"]);
    expect(modesOf(f)).toEqual(["do", "create"]);
  });

  it("feature keys are unique", () => {
    const f = tree([...TEACHER_CAPS, ...PRINCIPAL_CAPS], [...TEACHER_TASKS, ...PRINCIPAL_TASKS], "principal");
    expect(new Set(f.map((x) => x.key)).size).toBe(f.length);
  });
});

describe("featureEffect", () => {
  it("says what a click does before the click", () => {
    expect(featureEffect({ kind: "task", mode: "do" }, false)).toBe("Opens a card to approve");
    expect(featureEffect({ kind: "task", mode: "do" }, true)).toBe("Sends your message for this task");
    expect(featureEffect({ kind: "open", mode: "create" }, false)).toBe("Opens page");
    expect(featureEffect({ kind: "ask", mode: "create" }, false)).toBe("Starts a draft");
  });
});

describe("searchFeatures", () => {
  const f = tree(TEACHER_CAPS, TEACHER_TASKS, "teacher");

  it("searches every mode at once and ranks a label that starts with the query first", () => {
    const hits = searchFeatures(f, "mark");
    expect(hits[0]).toMatchObject({ kind: "task", task: "attendance.mark" });
    expect(searchFeatures(f, "publish").map((x) => x.mode)).toContain("teach");
  });

  it("matches section and mode names, needs every word, and is empty for blank or unknown queries", () => {
    expect(searchFeatures(f, "manage").map((x) => x.task)).toEqual(["ptm.slot.create"]);
    expect(searchFeatures(f, "diary post").map((x) => x.task)).toEqual(["diary.entry.create"]);
    expect(searchFeatures(f, "  ")).toEqual([]);
    expect(searchFeatures(f, "zzz")).toEqual([]);
  });

  it("dedupes a recent prompt against the same ready prompt and respects the limit", () => {
    const ask = f.find((x) => x.mode === "ask") as OrbFeature;
    const recent: OrbFeature = { ...ask, key: `recent:${ask.label}`, groupId: "recent" };
    const word = ask.label.split(" ")[0];
    expect(searchFeatures([recent, ...f], word).filter((x) => x.label === ask.label)).toHaveLength(1);
    expect(searchFeatures(f, "a", 2)).toHaveLength(2);
  });
});

describe("URL and query", () => {
  const enabled = TEACHER_TASKS;

  it("accepts a known mode, an enabled task (with its mode) and a trimmed question", () => {
    expect(parseOrbQuery({ mode: "do", task: "attendance.mark", q: "  who is absent?  " }, enabled)).toEqual({
      mode: "do",
      task: { action: "attendance.mark", mode: "do" },
      q: "who is absent?",
    });
  });

  it("drops an unknown mode, a task that is not enabled or malformed, repeated params and empty q", () => {
    expect(parseOrbQuery({ mode: "hack", task: "finance.payment.record" }, enabled)).toEqual({});
    expect(parseOrbQuery({ task: "../attendance.mark" }, enabled)).toEqual({});
    expect(parseOrbQuery({ mode: ["do", "ask"], task: ["attendance.mark"], q: "   " }, enabled)).toEqual({});
    expect(parseOrbQuery({ q: "x".repeat(900) }, enabled).q).toHaveLength(500);
  });

  it("picks the URL mode, then the task's, then a stored mode that still exists, then the first", () => {
    const available = ["ask", "do", "create"] as const;
    expect(pickMode(available, { url: "manage", task: "do", stored: "create" })).toBe("manage");
    expect(pickMode(available, { task: "do", stored: "create" })).toBe("do");
    expect(pickMode(available, { stored: "create" })).toBe("create");
    expect(pickMode(available, { stored: "teach" })).toBe("ask");
    expect(pickMode(available, { stored: "nonsense" })).toBe("ask");
    expect(pickMode([], {})).toBe("ask");
  });

  it("builds launcher deep links and maps a page to its section", () => {
    expect(orbUrl("demo", "/demo/attendance", undefined, { mode: "do", task: "attendance.mark" })).toBe(
      "/demo/orb?from=%2Fdemo%2Fattendance&mode=do&task=attendance.mark",
    );
    expect(orbUrl("demo", "/demo/finance", "Who owes fees?")).toBe("/demo/orb?from=%2Fdemo%2Ffinance&q=Who%20owes%20fees%3F");
    expect(sectionForPath("/finance/invoices")).toBe("finance");
    expect(sectionForPath("/fabric/insights/x")).toBe("insights");
    expect(sectionForPath("/settings")).toBeNull();
  });
});
