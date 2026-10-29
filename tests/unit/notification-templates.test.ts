import { describe, expect, it, vi } from "vitest";
import { NOTIFICATION_TEMPLATES, NOTIFICATION_TYPES } from "@/modules/notifications/templates";
import { inApp } from "@/modules/notifications/channels/inApp";
import { simulatedEmail } from "@/modules/notifications/channels/simulatedEmail";
import { simulatedSms } from "@/modules/notifications/channels/simulatedSms";

const ATTENDANCE_VARS = { student: "Aarav Sharma", class: "X-A", date: "2026-10-29", school: "St. Joseph" };

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

  it("every type's channel list matches the 06 §3 table", () => {
    expect(NOTIFICATION_TEMPLATES.attendance_absence.channels).toEqual(["in_app", "sms"]);
    expect(NOTIFICATION_TEMPLATES.results_published.channels).toEqual(["in_app", "sms"]);
    expect(NOTIFICATION_TEMPLATES.recheck_decided.channels).toEqual(["in_app", "sms"]);
    expect(NOTIFICATION_TEMPLATES.enquiry_received.channels).toEqual(["in_app"]);
    expect(NOTIFICATION_TEMPLATES.enrolment_welcome.channels).toEqual(["in_app", "email"]);
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

  it("simulated channels fail gracefully with no contact address, without throwing", async () => {
    expect(await simulatedSms.send({ toAddress: null, renderedBody: "x" })).toMatchObject({ status: "failed" });
    expect(await simulatedEmail.send({ toAddress: null, renderedBody: "x" })).toMatchObject({ status: "failed" });
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
