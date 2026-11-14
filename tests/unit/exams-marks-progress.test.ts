import { describe, expect, it } from "vitest";
import { daysLeft, marksProgress, marksReminders, type PaperTeacher } from "@/modules/exams/marks-progress";

const veronica: PaperTeacher = { staffId: "s-ver", userId: "u-ver", name: "Veronica Thomas" };
const arjun: PaperTeacher = { staffId: "s-arj", userId: "u-arj", name: "Arjun Rao" };
const noLogin: PaperTeacher = { staffId: "s-old", userId: null, name: "Meena Iyer" };

const papers = [
  { id: "p-phy", sectionId: "11a", subjectId: "phy", label: "11-A Physics" },
  { id: "p-che", sectionId: "11a", subjectId: "che", label: "11-A Chemistry" },
  { id: "p-eng", sectionId: "10b", subjectId: "eng", label: "10-B English" },
  { id: "p-art", sectionId: "9c", subjectId: "art", label: "9-C Art" },
];
const counts = new Map([
  ["p-phy", { entered: 0, total: 40 }],
  ["p-che", { entered: 12, total: 40 }],
  ["p-eng", { entered: 35, total: 35 }],
  ["p-art", { entered: 0, total: 0 }],
]);
const subjectTeachers = new Map([["11a:phy", veronica], ["10b:eng", arjun]]);
const classTeachers = new Map([["11a", veronica], ["9c", noLogin]]);

describe("marksProgress", () => {
  const rows = marksProgress(papers, counts, subjectTeachers, classTeachers);

  it("names the subject teacher, else the class teacher, else nobody", () => {
    expect(rows.map((r) => [r.paperId, r.teacher?.name ?? null])).toEqual([
      ["p-phy", "Veronica Thomas"],
      ["p-che", "Veronica Thomas"],
      ["p-eng", "Arjun Rao"],
      ["p-art", "Meena Iyer"],
    ]);
  });

  it("a paper is done when every active student has a mark or an absent flag; an empty section is done", () => {
    expect(rows.map((r) => [r.paperId, r.done])).toEqual([
      ["p-phy", false],
      ["p-che", false],
      ["p-eng", true],
      ["p-art", true],
    ]);
  });

  it("a paper with no counts row is not done and shows 0 of 0 only when the section is empty", () => {
    const [row] = marksProgress([{ id: "p-x", sectionId: "12a", subjectId: "bio", label: "12-A Biology" }], new Map(), new Map(), new Map());
    expect(row).toMatchObject({ entered: 0, total: 0, done: true, teacher: null });
  });
});

describe("daysLeft", () => {
  it("counts whole days between two ISO dates", () => {
    expect(daysLeft("2026-07-20", "2026-07-18")).toBe(2);
    expect(daysLeft("2026-07-20", "2026-07-20")).toBe(0);
    expect(daysLeft("2026-07-20", "2026-07-23")).toBe(-3);
  });
});

describe("marksReminders", () => {
  const progress = new Map([["e-ut1", marksProgress(papers, counts, subjectTeachers, classTeachers)]]);
  const exam = { id: "e-ut1", name: "UT1", dueOn: "2026-07-20" };
  const office = ["u-nitin"];

  it("sends nothing more than 2 days before the due date", () => {
    expect(marksReminders([exam], progress, office, "2026-07-17")).toEqual([]);
  });

  it("2 days before: one reminder per teacher listing all their missing papers, and one to each office person naming who is late", () => {
    const sent = marksReminders([exam], progress, office, "2026-07-18");
    expect(sent).toEqual([
      { recipientUserId: "u-ver", entityId: "e-ut1:2026-07-18:teacher", summary: "UT1: marks are due 20 Jul for 11-A Physics (0/40), 11-A Chemistry (12/40)." },
      { recipientUserId: "u-nitin", entityId: "e-ut1:2026-07-18:office", summary: "UT1: marks are due 20 Jul. Not submitted: Veronica Thomas: 11-A Physics (0/40), 11-A Chemistry (12/40)." },
    ]);
  });

  it("after the date: says how late, and keeps going every day", () => {
    const [toTeacher] = marksReminders([exam], progress, office, "2026-07-23");
    expect(toTeacher.summary).toBe("UT1: marks are 3 days late (due 20 Jul) for 11-A Physics (0/40), 11-A Chemistry (12/40).");
    expect(marksReminders([exam], progress, office, "2026-07-24")[0].entityId).toBe("e-ut1:2026-07-24:teacher");
  });

  it("a teacher without a login still shows up by name for the office; a paper with no teacher says so", () => {
    const late = marksProgress(
      [{ id: "p-art", sectionId: "9c", subjectId: "art", label: "9-C Art" }, { id: "p-bio", sectionId: "12a", subjectId: "bio", label: "12-A Biology" }],
      new Map([["p-art", { entered: 1, total: 30 }], ["p-bio", { entered: 0, total: 20 }]]),
      new Map(),
      classTeachers,
    );
    const sent = marksReminders([exam], new Map([["e-ut1", late]]), office, "2026-07-20");
    expect(sent.map((s) => s.recipientUserId)).toEqual(["u-nitin"]);
    expect(sent[0].summary).toBe("UT1: marks are due today. Not submitted: Meena Iyer: 9-C Art (1/30); no teacher assigned: 12-A Biology (0/20).");
  });

  it("an exam with every paper done sends nothing", () => {
    const done = marksProgress(papers.slice(2), counts, subjectTeachers, classTeachers);
    expect(marksReminders([exam], new Map([["e-ut1", done]]), office, "2026-07-25")).toEqual([]);
  });

  it("keeps each summary within the 300-character notification limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, sectionId: "11a", subjectId: `s${i}`, label: `11-A Subject number ${i}` }));
    const rows = marksProgress(many, new Map(), new Map(), new Map([["11a", veronica]]));
    const filled = rows.map((r) => ({ ...r, total: 40, done: false }));
    for (const s of marksReminders([exam], new Map([["e-ut1", filled]]), office, "2026-07-20")) expect(s.summary.length).toBeLessThanOrEqual(300);
  });
});
