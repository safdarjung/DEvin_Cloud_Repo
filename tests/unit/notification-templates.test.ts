import { describe, expect, it, vi } from "vitest";
import { NOTIFICATION_TEMPLATES, NOTIFICATION_TYPES } from "@/modules/notifications/templates";
import { inApp } from "@/modules/notifications/channels/inApp";
import { simulatedEmail } from "@/modules/notifications/channels/simulatedEmail";
import { simulatedSms } from "@/modules/notifications/channels/simulatedSms";
import { simulatedWhatsApp } from "@/modules/notifications/channels/whatsapp";

const ATTENDANCE_VARS = { student: "Aarav Sharma", class: "X-A", date: "2026-10-29", school: "Fabric School" };

describe("NOTIFICATION_TEMPLATES (06 §3)", () => {
  it("has a template for every registered notification type", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(NOTIFICATION_TEMPLATES[type]).toBeDefined();
    }
  });

  it("attendance_absence rejects extra or missing variables (strict schema)", () => {
    const { varsSchema } = NOTIFICATION_TEMPLATES.attendance_absence;
    expect(varsSchema.safeParse(ATTENDANCE_VARS).success).toBe(true);
    expect(varsSchema.safeParse({ ...ATTENDANCE_VARS, extra: "x" }).success).toBe(false);
    expect(varsSchema.safeParse({ student: "Aarav" }).success).toBe(false);
  });

  it("renders EN and HI bodies with different text for the same variables", () => {
    const { body } = NOTIFICATION_TEMPLATES.attendance_absence;
    const en = body(ATTENDANCE_VARS, "en");
    const hi = body(ATTENDANCE_VARS, "hi");
    expect(en).not.toBe(hi);
    expect(en).toContain(ATTENDANCE_VARS.student);
    expect(hi).toContain(ATTENDANCE_VARS.student);
  });

  it("attendance_absence SMS body fits a single SMS segment (160 chars) with realistic variables", () => {
    const { body } = NOTIFICATION_TEMPLATES.attendance_absence;
    expect(body(ATTENDANCE_VARS, "en").length).toBeLessThanOrEqual(160);
  });

  // X05-T3 — whatsapp sits right after sms in every sms-channel type's list.
  it("every type's channel list matches the 06 §3 table", () => {
    expect(NOTIFICATION_TEMPLATES.attendance_absence.channels).toEqual(["in_app", "sms", "whatsapp"]);
    expect(NOTIFICATION_TEMPLATES.results_published.channels).toEqual(["in_app", "sms", "whatsapp"]);
    expect(NOTIFICATION_TEMPLATES.recheck_decided.channels).toEqual(["in_app", "sms", "whatsapp"]);
    expect(NOTIFICATION_TEMPLATES.enquiry_received.channels).toEqual(["in_app"]);
    expect(NOTIFICATION_TEMPLATES.enrolment_welcome.channels).toEqual(["in_app", "email"]);
    expect(NOTIFICATION_TEMPLATES.announcement.channels).toEqual(["in_app", "sms", "whatsapp", "email"]);
  });

  // M06-T3: every template's category drives createNotification's
  // preference lookup (notification_preferences.category, 0068).
  it("every type's category matches the M06 header ruling", () => {
    expect(NOTIFICATION_TEMPLATES.attendance_absence.category).toBe("attendance");
    expect(NOTIFICATION_TEMPLATES.results_published.category).toBe("academic");
    expect(NOTIFICATION_TEMPLATES.recheck_decided.category).toBe("academic");
    expect(NOTIFICATION_TEMPLATES.enquiry_received.category).toBe("admissions");
    expect(NOTIFICATION_TEMPLATES.enrolment_welcome.category).toBe("admissions");
    expect(NOTIFICATION_TEMPLATES.announcement.category).toBe("announcement");
  });

  it("announcement renders title + excerpt and rejects extra or missing variables (strict schema)", () => {
    const { varsSchema, body } = NOTIFICATION_TEMPLATES.announcement;
    const vars = { title: "Holiday", excerpt: "School closed Friday for a festival." };
    expect(varsSchema.safeParse(vars).success).toBe(true);
    expect(varsSchema.safeParse({ ...vars, extra: "x" }).success).toBe(false);
    expect(varsSchema.safeParse({ title: "Holiday" }).success).toBe(false);
    expect(body(vars, "en")).toContain("Holiday");
    expect(body(vars, "en")).toContain(vars.excerpt);
  });

  it("fee_reminder renders EN and HI with all vars and rejects missing fields", () => {
    const { varsSchema, body } = NOTIFICATION_TEMPLATES.fee_reminder;
    const vars = { student: "Aarav Sharma", invoice_no: "INV-001", amount: "₹12,345.00", due_on: "2026-11-30", school: "Fabric School" };
    expect(varsSchema.safeParse(vars).success).toBe(true);
    expect(varsSchema.safeParse({ ...vars, extra: "x" }).success).toBe(false);
    expect(varsSchema.safeParse({ student: "Aarav", invoice_no: "INV-001", amount: "₹1,000", due_on: "2026-11-30" }).success).toBe(false);
    const en = body(vars, "en");
    const hi = body(vars, "hi");
    expect(en).not.toBe(hi);
    expect(en).toContain(vars.amount);
    expect(en).toContain(vars.student);
    expect(hi).toContain(vars.amount);
    expect(hi).toContain(vars.student);
  });

  it("fee_reminder has category 'finance' and channels ['in_app', 'sms', 'whatsapp', 'email']", () => {
    expect(NOTIFICATION_TEMPLATES.fee_reminder.category).toBe("finance");
    expect(NOTIFICATION_TEMPLATES.fee_reminder.channels).toEqual(["in_app", "sms", "whatsapp", "email"]);
  });
});

describe("simulated channels never touch the network", () => {
  it("simulatedSms.send never calls fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await simulatedSms.send({ toAddress: "9876543210", renderedBody: "test" });
    expect(result.status).toBe("simulated");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("simulatedEmail.send never calls fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await simulatedEmail.send({ toAddress: "guardian@example.com", renderedBody: "test" });
    expect(result.status).toBe("simulated");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("simulatedWhatsApp.send never calls fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await simulatedWhatsApp.send({ toAddress: "9876543210", renderedBody: "test" });
    expect(result.status).toBe("simulated");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("simulated channels fail gracefully with no contact address, without throwing", async () => {
    expect(await simulatedSms.send({ toAddress: null, renderedBody: "x" })).toMatchObject({ status: "failed" });
    expect(await simulatedEmail.send({ toAddress: null, renderedBody: "x" })).toMatchObject({ status: "failed" });
    expect(await simulatedWhatsApp.send({ toAddress: null, renderedBody: "x" })).toMatchObject({ status: "failed" });
  });

  it("inApp.send never calls fetch and always succeeds", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await inApp.send({ toAddress: null, renderedBody: "test" });
    expect(result.status).toBe("sent");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

  it("report_ready renders EN and HI with both vars and rejects missing date", () => {
    const { varsSchema, body, channels, category } = NOTIFICATION_TEMPLATES.report_ready;
    const vars = { report: "Daily Attendance", date: "2026-11-04" };
    expect(varsSchema.safeParse(vars).success).toBe(true);
    expect(varsSchema.safeParse({ ...vars, extra: "x" }).success).toBe(false);
    expect(varsSchema.safeParse({ report: "Daily Attendance" }).success).toBe(false);
    expect(varsSchema.safeParse({ ...vars, date: "" }).success).toBe(false);
    const en = body(vars, "en");
    const hi = body(vars, "hi");
    expect(en).not.toBe(hi);
    expect(en).toContain(vars.report);
    expect(en).toContain(vars.date);
    expect(hi).toContain(vars.report);
    expect(hi).toContain(vars.date);
    expect(channels).toEqual(["in_app"]);
    expect(category).toBe("report");
  });

  it("workflow_alert renders EN with workflow and message, shows HI title, and validates vars (M23-T6)", () => {
    const { varsSchema, body, title, channels, category } = NOTIFICATION_TEMPLATES.workflow_alert;
    const vars = { workflow: "Absence follow-up", message: "2 absent" };
    expect(varsSchema.safeParse(vars).success).toBe(true);
    expect(varsSchema.safeParse({ ...vars, extra: "x" }).success).toBe(false);
    expect(varsSchema.safeParse({ workflow: "Absence follow-up" }).success).toBe(false);
    const en = body(vars, "en");
    expect(en).toBe("Absence follow-up: 2 absent");
    expect(title("hi", vars)).toBe("वर्कफ़्लो अलर्ट");
    expect(title("en", vars)).toBe("Workflow alert");
    expect(channels).toEqual(["in_app"]);
    expect(category).toBe("announcement");
    // Reject 301-char message
    const longMessage = "x".repeat(301);
    expect(varsSchema.safeParse({ workflow: "Test", message: longMessage }).success).toBe(false);
  });
