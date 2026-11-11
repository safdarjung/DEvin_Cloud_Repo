import { describe, expect, it, vi } from "vitest";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { allModulesOn } from "@/lib/modules/catalog";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { FILE_ATTACH_GROUP, FILE_ATTACH_TOOL, fileAttachTool, mentionsFileAttach } from "@/modules/textbooks/ai-attach-tool";
import { attachMessage } from "@/modules/textbooks/components/ChatFileAttach";
import { selectTools } from "@/lib/ai/tool-budget";

function ctxFor(role: Role): TenantContext {
  return {
    institution: { id: "inst-1", slug: "attach", name: "Attach", settings: { modules: allModulesOn() }, ai_policy: "local_only", is_demo: true },
    user: { id: "user-1", profile: { fullName: "Probe", phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role, staffId: role === "teacher" ? "staff-1" : null, guardianId: null, studentId: role === "student" ? "stu-1" : null },
    permissions: new Set(permissionsFor(role)),
  };
}

const ID = "00000000-0000-4000-8000-000000000001";

describe("chat file attach tool", () => {
  it("is offered only to teachers and students, only when the talk is about an upload, never in a preview", () => {
    const upload = ['I uploaded the file "notes.pdf"'];
    expect(fileAttachTool(ctxFor("teacher"), "teacher", upload)).not.toBeNull();
    expect(fileAttachTool(ctxFor("student"), "student", upload)).not.toBeNull();
    expect(fileAttachTool(ctxFor("student"), "student", ["explain photosynthesis"])).toBeNull();
    for (const role of ["guardian", "owner", "accountant"] as Role[]) expect(fileAttachTool(ctxFor(role), role, upload)).toBeNull();
    expect(fileAttachTool(ctxFor("owner"), "teacher", upload)).toBeNull();
    expect(mentionsFileAttach(["Can I attach this?"])).toBe(true);
    expect(mentionsFileAttach(["fees due this term"])).toBe(false);
  });

  it("asks only for the subject; anything else missing is filled from the person's own data", async () => {
    const t = fileAttachTool(ctxFor("student"), "student", ["uploaded"])!;
    const out = await Promise.resolve(t.execute!({ unitId: ID } as never, { toolCallId: "c", messages: [] } as never));
    expect(out).toMatch(/^Invalid input: subjectId/);
  });

  it("the budget picks its group for an upload message", () => {
    const tools = { [FILE_ATTACH_TOOL]: fileAttachTool(ctxFor("teacher"), "teacher", ["uploaded"])!, other: fileAttachTool(ctxFor("student"), "student", ["uploaded"])! };
    const groups = [
      { key: "fees", label: "Fees", description: "Fee dues and invoices", tools: ["other"] },
      FILE_ATTACH_GROUP,
    ];
    const pick = selectTools({ tools, groups, core: [], texts: ['I uploaded the file "notes.pdf" (1.2 MB). Propose where to attach it.'], budget: 5000 });
    expect(pick.groups[0]).toBe("file_attach");
  });

  it("the chat message carries only name, size, id and the person's own subjects/units", () => {
    const text = attachMessage({ fileName: "ch4.pdf", sizeBytes: 2048, materialId: ID }, [
      { gradeId: "g", gradeName: "Grade X", subjectId: "s", subjectName: "Mathematics", units: [{ id: "u", title: "Quadratic Equations" }] },
    ]);
    expect(text).toContain('"ch4.pdf" (2 KB), file id ' + ID);
    expect(text).toContain("Grade X (grade g):\n- Mathematics (subject s): Quadratic Equations (unit u)");
  });

  it("stays under the chat's 4000-character text limit however many subjects there are", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      gradeId: ID, gradeName: "Grade X", subjectId: ID, subjectName: `Subject ${i}`,
      units: Array.from({ length: 4 }, (_, j) => ({ id: ID, title: `Unit ${i}.${j} with a fairly long title` })),
    }));
    const text = attachMessage({ fileName: "x".repeat(200) + ".pdf", sizeBytes: 1, materialId: ID }, many);
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toContain("(list cut short)");
  });
});
