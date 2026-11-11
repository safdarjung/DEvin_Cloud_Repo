// Fixture proposals shaped like propose_task output (design §3). Used by unit tests and local previews.
import type { TaskFieldView, TaskProposalOutput, TaskView } from "@/modules/ai/tasks/types";

const IN_30_MIN = () => new Date(Date.now() + 30 * 60_000).toISOString();

const base = (v: Partial<TaskView> & Pick<TaskView, "action" | "label" | "title" | "fields">): TaskView => ({
  mode: "do", groupId: "operations" as TaskView["groupId"], risk: "user_confirmed", values: {}, resolved: {}, candidates: {}, expiresAt: IN_30_MIN(), ...v,
});

export const libraryLoanIssue = (): TaskProposalOutput => ({
  kind: "task_proposal",
  proposalId: "p-library-1",
  view: base({
    action: "library.loan.issue",
    label: "Issue a library book",
    title: "Issue a library book to Ravi Kumar",
    fields: [
      { path: "/accessionNo", label: "Accession number", kind: "natural_key", required: true, maxLength: 40 },
      { path: "/studentId", label: "Student", kind: "entity", entity: "student", required: true },
      { path: "/dueOn", label: "Due on", kind: "date", required: false },
      { path: "/notes", label: "Notes", kind: "long_text", required: false, maxLength: 200 },
    ],
    values: { accessionNo: "LIB-00231", studentId: "s-ravi-8b", dueOn: "2026-11-25" },
    resolved: { "/studentId": { id: "s-ravi-8b", label: "Ravi Kumar", hint: "8B" } },
    candidates: {},
    undo: "library.loan.return",
  }),
});

const attendanceFields: TaskFieldView[] = [
  { path: "/sectionId", label: "Class section", kind: "entity", entity: "classSection", required: true },
  { path: "/date", label: "Date", kind: "date", required: true },
  {
    path: "/records", label: "Student", kind: "array", required: true, maxItems: 60,
    fields: [
      { path: "/records/*/studentId", label: "Student", kind: "entity", entity: "student", required: true },
      { path: "/records/*/status", label: "Status", kind: "enum", required: true, options: ["present", "absent", "late"] },
    ],
  },
];

export const attendanceMark = (): TaskProposalOutput => {
  const names = ["Aarav Shah", "Ravi Kumar", "Meera Iyer", "Sana Khan", "Dev Patel", "Isha Rao"];
  const resolved: Record<string, { id: string; label: string }> = {};
  names.forEach((n, i) => (resolved[`/records/${i}/studentId`] = { id: `s${i}`, label: n }));
  return {
    kind: "task_proposal",
    proposalId: "p-att-1",
    view: base({
      action: "attendance.mark",
      label: "Mark attendance",
      title: "Mark attendance for 8B on 11 Nov",
      risk: "low_risk_reversible",
      renderer: "attendance.register",
      fields: attendanceFields,
      values: {
        sectionId: "sec-8b", date: "2026-11-11",
        records: names.map((_, i) => ({ studentId: `s${i}`, status: i === 1 ? "absent" : "present" })),
      },
      resolved: { ...resolved, "/sectionId": { id: "sec-8b", label: "Class 8B" } },
    }),
  };
};

export const leaveApprove = (): TaskProposalOutput => ({
  kind: "task_proposal",
  proposalId: "p-leave-1",
  view: base({
    action: "people.leave.approve",
    label: "Approve a leave request",
    title: "Approve leave for Mrs. Nair, 12 to 14 Nov",
    risk: "human_approved",
    provenance: "Suggested after reading a helpdesk message",
    fields: [
      { path: "/leaveId", label: "Leave request", kind: "entity", entity: "staffLeave", required: true },
      { path: "/status", label: "Decision", kind: "enum", required: true, options: ["approved", "rejected"] },
      { path: "/comment", label: "Comment", kind: "text", required: false, maxLength: 120 },
    ],
    values: { leaveId: "lv-9", status: "approved" },
    resolved: { "/leaveId": { id: "lv-9", label: "Mrs. Nair, 12 to 14 Nov" } },
  }),
});

export const expensesRecord = (): TaskProposalOutput => ({
  kind: "task_proposal",
  proposalId: "p-exp-1",
  view: base({
    action: "expenses.record",
    label: "Record an expense",
    title: "Record an expense: chalk and markers",
    family: "money",
    fields: [
      { path: "/categoryId", label: "Category", kind: "entity", entity: "expenses.category", required: true },
      { path: "/amount", label: "Amount", kind: "rupee_text", required: true, humanOnly: true },
      { path: "/description", label: "Description", kind: "text", required: true, maxLength: 200 },
      { path: "/key", label: "Key", kind: "generated", required: false },
    ],
    // The model must never supply it, but a bad server would leak it here: the card must ignore it.
    values: { categoryId: "cat-stationery", description: "Chalk and markers", amount: "99999" },
    resolved: { "/categoryId": { id: "cat-stationery", label: "Stationery" } },
  }),
});

export const dependentStack = (): TaskProposalOutput[] => {
  const mark = attendanceMark();
  const submit: TaskProposalOutput = {
    kind: "task_proposal",
    proposalId: "p-att-submit",
    view: base({
      action: "attendance.submit",
      label: "Submit attendance",
      title: "Submit 8B attendance (sends 1 absence notice)",
      risk: "low_risk_reversible",
      dependsOn: mark.proposalId,
      fields: [{ path: "/sessionId", label: "Session", kind: "context", required: true }],
    }),
  };
  return [mark, submit];
};
