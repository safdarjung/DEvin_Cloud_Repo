// 05 §4.1 — institutions.settings shape, validated before every write (T-012
// security requirement: "Settings JSON validated by InstitutionSettingsSchema
// before insert"). Lead-owned, like src/lib/auth/permissions.ts.
import { z } from "zod";

const GradingBand = z
  .object({
    min: z.number().min(0).max(100),
    max: z.number().min(0).max(100),
    grade: z.string().min(1),
    points: z.number().min(0),
    fail: z.boolean().optional(),
  })
  .strict();

const AttendanceStatus = z
  .object({
    code: z.string().min(1),
    label: z.string().min(1),
    counts_present: z.number().min(0).max(1),
    in_denominator: z.boolean(),
    notify_guardian: z.boolean().optional(),
  })
  .strict();

export const InstitutionSettingsSchema = z
  .object({
    locale: z
      .object({
        timezone: z.string().min(1),
        currency: z.string().min(1),
      })
      .strict(),
    academic: z
      .object({
        section_names: z.array(z.string().min(1)).min(1),
        max_section_size: z.number().int().positive(),
        grade_groups: z
          .object({
            primary: z.array(z.string().min(1)),
            middle: z.array(z.string().min(1)),
            secondary: z.array(z.string().min(1)),
            senior_secondary: z.array(z.string().min(1)),
          })
          .strict(),
      })
      .strict(),
    attendance: z
      .object({
        mode: z.string().min(1),
        correction_window_days: z.number().int().nonnegative(),
        statuses: z.array(AttendanceStatus).min(1),
        alert_thresholds: z
          .object({
            warn: z.number().min(0).max(100),
            critical: z.number().min(0).max(100),
          })
          .strict(),
      })
      .strict(),
    exams: z
      .object({
        pass_percentage: z.number().min(0).max(100),
        types: z.array(z.string().min(1)).min(1),
        grading_scales: z.record(z.string(), z.array(GradingBand).min(1)),
        recheck_window_days: z.number().int().nonnegative(),
      })
      .strict(),
    finance: z
      .object({
        financial_year_start_month: z.number().int().min(1).max(12),
        default_due_day: z.number().int().min(1).max(31),
        late_fee: z
          .object({
            grace_days: z.number().int().nonnegative(),
            type: z.string().min(1),
            amount: z.number().nonnegative(),
          })
          .strict(),
        payment_modes: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    numbering: z.record(z.string(), z.string().min(1)),
    admissions: z
      .object({
        screening_allowed_from_grade: z.string().min(1),
        stages: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    ai: z
      .object({
        daily_token_quota: z.number().int().positive(),
        per_user_per_minute: z.number().int().positive(),
        max_concurrent_local: z.number().int().positive(),
        max_concurrent_cloud: z.number().int().positive(),
      })
      .strict(),
    communication: z
      .object({
        languages: z.array(z.string().min(1)).min(1),
        sms_sender: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type InstitutionSettings = z.infer<typeof InstitutionSettingsSchema>;

// 05 §4.1, verbatim — the seed writes this; tests/unit/institution-settings.test.ts
// asserts it parses.
export const DEFAULT_INSTITUTION_SETTINGS: InstitutionSettings = {
  locale: { timezone: "Asia/Kolkata", currency: "INR" },
  academic: {
    section_names: ["A", "B", "C", "D", "E", "F"],
    max_section_size: 40,
    grade_groups: {
      primary: ["I", "II", "III", "IV", "V"],
      middle: ["VI", "VII", "VIII"],
      secondary: ["IX", "X"],
      senior_secondary: ["XI", "XII"],
    },
  },
  attendance: {
    mode: "daily",
    correction_window_days: 3,
    statuses: [
      { code: "P", label: "Present", counts_present: 1, in_denominator: true },
      { code: "A", label: "Absent", counts_present: 0, in_denominator: true, notify_guardian: true },
      { code: "L", label: "Late", counts_present: 1, in_denominator: true },
      { code: "HD", label: "Half day", counts_present: 0.5, in_denominator: true },
      { code: "OL", label: "On leave", counts_present: 0, in_denominator: true },
    ],
    alert_thresholds: { warn: 80, critical: 75 },
  },
  exams: {
    pass_percentage: 33,
    types: ["unit_test", "half_yearly", "annual"],
    grading_scales: {
      default: [
        { min: 91, max: 100, grade: "A1", points: 10 },
        { min: 81, max: 90, grade: "A2", points: 9 },
        { min: 71, max: 80, grade: "B1", points: 8 },
        { min: 61, max: 70, grade: "B2", points: 7 },
        { min: 51, max: 60, grade: "C1", points: 6 },
        { min: 41, max: 50, grade: "C2", points: 5 },
        { min: 33, max: 40, grade: "D", points: 4 },
        { min: 21, max: 32, grade: "E1", points: 0, fail: true },
        { min: 0, max: 20, grade: "E2", points: 0, fail: true },
      ],
    },
    recheck_window_days: 7,
  },
  finance: {
    financial_year_start_month: 4,
    default_due_day: 10,
    late_fee: { grace_days: 10, type: "flat_monthly", amount: 200 },
    payment_modes: ["cash", "upi", "cheque", "neft", "card"],
  },
  numbering: {
    admission_no: "ADM/{YYYY}/{SEQ:5}",
    employee_no: "EMP/{SEQ:4}",
    application_no: "APP/{YYYY}/{SEQ:5}",
    invoice_no: "INV/{FY}/{SEQ:6}",
    receipt_no: "RCT/{FY}/{SEQ:6}",
  },
  admissions: {
    screening_allowed_from_grade: "VI",
    stages: ["new", "contacted", "visit_scheduled", "application_sent", "converted", "closed"],
  },
  ai: {
    daily_token_quota: 200000,
    per_user_per_minute: 10,
    max_concurrent_local: 2,
    max_concurrent_cloud: 4,
  },
  communication: { languages: ["en", "hi"], sms_sender: "SJCDEM" },
};
