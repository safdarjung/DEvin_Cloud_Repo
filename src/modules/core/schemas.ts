// 05 §4.1 — institutions.settings shape, validated before every write (T-012
// security requirement: "Settings JSON validated by InstitutionSettingsSchema
// before insert"). Lead-owned, like src/lib/auth/permissions.ts.
import { z } from "zod";
// Relative + .ts: the seed scripts (plain node, no path alias) import this file.
import { isoDate, shortText, uuid } from "../../lib/schemas/common.ts";
import { MODULE_KEYS } from "../../lib/modules/catalog.ts";
import { DASHBOARD_WIDGET_IDS, MORE_CARD_IDS } from "./dashboard-widgets.ts";
import { MAX_TASK_OVERRIDES, ORB_GROUP_IDS, ORB_MODES, TASK_KEY_RE } from "./control-centre/ids.ts";
import { QUAL_LEVELS } from "../people/qualifications.ts";

// Equal to the SQL check institutions_slug_not_reserved (0127), which is the
// authority: a school slug must never shadow an app route or public page.
// tests/unit/reserved-slugs.test.ts keeps the two equal and fails when a new
// top-level src/app route segment is not reserved.
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "api", "s", "login", "logout", "auth", "admin", "app", "www", "static", "public", "demo", "invite", "onboarding",
  "portal", "sw", "select", "product", "modules", "ai", "security", "pricing", "how-it-works", "faq", "contact",
  "roles", "legal", "offline", "icon", "apple-icon", "opengraph-image", "sitemap", "robots", "manifest", "llms", "for-agents",
  "platform", "start", "tour", "fabricos",
]);

// M03-T4 — POST /api/v1/institutions body. Reserved-slug/quota/duplicate
// checks live in create_institution (SQL); this only validates shape.
export const CreateInstitutionSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: z.string().trim().min(3).max(40).refine((s) => !RESERVED_SLUGS.has(s), "slug is reserved"),
    timezone: z.string().trim().min(1).optional(),
    yearStart: isoDate.optional(),
  })
  .strict();

export type CreateInstitutionInput = z.infer<typeof CreateInstitutionSchema>;

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

// AI roles: the 9 membership roles whose AI the settings page configures.
export const AI_ROLES = [
  "owner",
  "principal",
  "admin",
  "admissions",
  "accountant",
  "exam_controller",
  "teacher",
  "student",
  "guardian",
] as const;

// Sparse per-role overrides. `modes`/`groups`/`tasks` (orb control centre) only
// ever narrow what permissions and modules allow; task keys are checked against
// the task catalog in core.ai_role.set (the catalog can change, stored settings must still parse).
function roleConfigShape<V extends z.ZodType>(flag: V) {
  return z
    .object({
      enabled: z.boolean().optional(),
      cloud: z.boolean().optional(),
      instructions: z.string().trim().max(500).optional(),
      daily_token_quota: z.number().int().min(0).max(10_000_000).optional(),
      capabilities: z.record(z.string().regex(/^[a-z][a-z0-9_]{1,40}$/), flag).optional(),
      modes: z.partialRecord(z.enum(ORB_MODES), flag).optional(),
      groups: z.partialRecord(z.enum(ORB_GROUP_IDS), flag).optional(),
      tasks: z
        .record(z.string().regex(TASK_KEY_RE), flag)
        .refine((o) => Object.keys(o).length <= MAX_TASK_OVERRIDES, "Too many task overrides.")
        .optional(),
    })
    .strict();
}

export const AiRoleConfigSchema = roleConfigShape(z.boolean());
/** Write side: a null flag removes that override (back to the default). Never stored. */
export const AiRoleConfigPatchSchema = roleConfigShape(z.boolean().nullable());

export type AiRoleConfig = z.infer<typeof AiRoleConfigSchema>;

// F18 §H setup wizard steps (institutions.settings.setup keys).
export const SETUP_STEPS = ["structure", "branding", "people", "invite", "modules"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

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
        // Upper caps stop an admin (or anyone on a demo admin login) lifting AI spend without bound.
        daily_token_quota: z.number().int().positive().max(10_000_000),
        per_user_per_minute: z.number().int().positive().max(600),
        max_concurrent_local: z.number().int().positive().max(64),
        max_concurrent_cloud: z.number().int().positive().max(64),
        // GU-08 security review (H1) — without this, one student chatting
        // can exhaust the whole institution's `daily_token_quota` and
        // lock teachers out of local AI for the rest of the day (the
        // concurrency slot is shared too; see usage.ts's student-only key).
        student_daily_token_quota: z.number().int().positive().max(10_000_000),
      })
      .strict(),
    communication: z
      .object({
        languages: z.array(z.string().min(1)).min(1),
        sms_sender: z.string().min(1),
      })
      .strict(),
    // D30/D33 — per-institution feature entitlements (what the platform
    // gives this customer), separate from role permissions (who within the
    // institution can use it). This is the closed set of feature keys
    // (`src/lib/auth/entitlements.ts`'s `FeatureKey` is derived from this
    // object's keys, not hand-duplicated) — a typo'd or retired key is a
    // Zod validation error, not a silently-ignored flag. Each key is
    // optional: a missing key falls back to `FEATURE_CATALOG`'s per-key
    // default in `isFeatureEnabled`, not a blanket "enabled" (D33
    // supersedes D30's blanket default for every key added after D30;
    // `teacher_ai_agent`'s own default stays `true`, unchanged).
    features: z
      .object({
        teacher_ai_agent: z.boolean().optional(),
        teacher_ai_visuals: z.boolean().optional(),
        teacher_ai_class_insights: z.boolean().optional(),
        teacher_ai_lesson_plans: z.boolean().optional(),
        teacher_ai_parent_messages: z.boolean().optional(),
        student_ai_study: z.boolean().optional(),
        student_ai_visuals: z.boolean().optional(),
        student_ai_notebook: z.boolean().optional(),
      })
      .strict(),
    // MOD — module entitlements (core modules always on; optional modules
    // can be disabled). Only optional keys allowed; missing key falls back
    // to catalog default in isModuleEnabled.
    modules: z
      .object({
        timetable: z.boolean().optional(),
        assignments: z.boolean().optional(),
        lesson_plans: z.boolean().optional(),
        question_bank: z.boolean().optional(),
        exams: z.boolean().optional(),
        exam_seating: z.boolean().optional(),
        admissions: z.boolean().optional(),
        website: z.boolean().optional(),
        staff_attendance: z.boolean().optional(),
        substitution: z.boolean().optional(),
        student_lifecycle: z.boolean().optional(),
        certificates: z.boolean().optional(),
        finance_plus: z.boolean().optional(),
        online_payments: z.boolean().optional(),
        fee_plans: z.boolean().optional(),
        facilities: z.boolean().optional(),
        transport: z.boolean().optional(),
        calendar: z.boolean().optional(),
        library: z.boolean().optional(),
        visitors: z.boolean().optional(),
        announcements: z.boolean().optional(),
        email: z.boolean().optional(),
        sms: z.boolean().optional(),
        whatsapp: z.boolean().optional(),
        ptm: z.boolean().optional(),
        student_leave: z.boolean().optional(),
        diary: z.boolean().optional(),
        messaging: z.boolean().optional(),
        practice: z.boolean().optional(),
        scheduled_reports: z.boolean().optional(),
        ai_teacher: z.boolean().optional(),
        ai_student: z.boolean().optional(),
        ai_briefings: z.boolean().optional(),
        insights: z.boolean().optional(),
        mastery: z.boolean().optional(),
        forecasts: z.boolean().optional(),
        agents: z.boolean().optional(),
        workflows: z.boolean().optional(),
        behaviour: z.boolean().optional(),
        health: z.boolean().optional(),
        clubs: z.boolean().optional(),
        hostel: z.boolean().optional(),
        school_labs: z.boolean().optional(),
        achievements: z.boolean().optional(),
        safety: z.boolean().optional(),
        compliance: z.boolean().optional(),
        resources: z.boolean().optional(),
        duties: z.boolean().optional(),
        expenses: z.boolean().optional(),
        scholarships: z.boolean().optional(),
        canteen: z.boolean().optional(),
        inventory: z.boolean().optional(),
        helpdesk: z.boolean().optional(),
        forms: z.boolean().optional(),
        alumni: z.boolean().optional(),
        payroll: z.boolean().optional(),
      })
      .strict()
      .optional(),
    library: z
      .object({
        loan_days: z.number().int().min(1).max(90),
        fine_per_day: z.number().min(0).max(100).multipleOf(0.01),
        max_loans_student: z.number().int().min(1).max(10),
        max_loans_staff: z.number().int().min(1).max(20),
      })
      .strict()
      .optional(),
    // Per-role AI config (AI roles ADR): narrows what each role's AI may do; never grants beyond permissions.ts.
    ai_roles: z.partialRecord(z.enum(AI_ROLES), AiRoleConfigSchema).optional(),
    // F18 §H — written only by core.setup.saveBranding (logo_path = this
    // school's `<institution_id>/logo.<ext>` in the public `school-branding`
    // bucket, 0127; never a URL) and core.setup.setProgress.
    branding: z
      .object({
        logo_path: z.string().regex(/^[0-9a-f-]{36}\/logo\.(png|jpg|jpeg|webp)$/).optional(),
        primary_color: z.string().regex(/^#[0-9a-f]{6}$/).optional(),
      })
      .strict()
      .optional(),
    setup: z.partialRecord(z.enum(SETUP_STEPS), z.enum(["done", "dismissed"])).optional(),
    // 0155 — written only by people.qualificationRules.save: the highest class (grade code) each
    // qualification level may teach; a missing level uses DEFAULT_MAX_GRADE (people/qualifications.ts).
    staff: z
      .object({ max_grade_by_level: z.partialRecord(z.enum(QUAL_LEVELS), z.string().min(1).max(20)).optional() })
      .strict()
      .optional(),
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
    // Kept at 10x the student cap (2026-11-13, D56) so a few students can't lock teachers out.
    daily_token_quota: 1000000,
    per_user_per_minute: 10,
    max_concurrent_local: 2,
    max_concurrent_cloud: 4,
    // GU-08 (D32 Revisit) — a placeholder sized against the plan's own
    // estimate (daily_token_quota ≈ 50 student turns/school/day): ~5
    // turns/student/day leaves room for several students concurrently
    // without one student alone exhausting the institution's quota.
    // Revisit from measured usage once a real school pilots this.
    // 2026-11-13: a tool-using orb turn costs ~4–8k tokens, so 20,000 was ~3–5 messages; ~15–25 now.
    student_daily_token_quota: 100000,
  },
  communication: { languages: ["en", "hi"], sms_sender: "SJCDEM" },
  features: { teacher_ai_agent: true },
};

// M03-T5 — core.member.invite / revokeInvite. Role covers all 9 membership
// roles; invite_member (0079) re-validates and does the owner/principal
// escalation check at the SQL layer, so this is shape-only.
const MEMBERSHIP_ROLES = [
  "owner",
  "principal",
  "admin",
  "admissions",
  "accountant",
  "exam_controller",
  "teacher",
  "student",
  "guardian",
] as const;

export const InviteMemberSchema = z
  .object({
    email: z.string().trim().email().max(200),
    role: z.enum(MEMBERSHIP_ROLES),
    staffId: uuid.optional(),
    guardianId: uuid.optional(),
    studentId: uuid.optional(),
  })
  .strict();
export type InviteMemberInput = z.infer<typeof InviteMemberSchema>;

export const RevokeInvitationSchema = z.object({ invitationId: uuid }).strict();
export type RevokeInvitationInput = z.infer<typeof RevokeInvitationSchema>;

// M03-T6 — POST /api/v1/invitations/accept body. accept_invitation (0079)
// hex-encodes 32 random bytes, so the token is always exactly 64 lowercase
// hex characters; shape-only check, state checks live in the RPC.
export const AcceptInvitationSchema = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export type AcceptInvitationInput = z.infer<typeof AcceptInvitationSchema>;

// M03-T7 — core.member.setRole / setStatus. setRole only moves a membership
// between staff-class roles (app.staff_roles(), 0001) — the link column
// (staff_id) never changes; moving to/from student or guardian needs a
// different link type, out of scope (no such case in M03, YAGNI).
const STAFF_CLASS_ROLES = [
  "owner",
  "principal",
  "admin",
  "admissions",
  "accountant",
  "exam_controller",
  "teacher",
] as const;

export const SetMemberRoleSchema = z.object({ membershipId: uuid, role: z.enum(STAFF_CLASS_ROLES) }).strict();
export type SetMemberRoleInput = z.infer<typeof SetMemberRoleSchema>;

export const SetMemberStatusSchema = z
  .object({ membershipId: uuid, status: z.enum(["active", "disabled"]) })
  .strict();
export type SetMemberStatusInput = z.infer<typeof SetMemberStatusSchema>;

// MOD-T4 — core.module.set action input.
export const SetModuleEnabledSchema = z
  .object({
    // Derived from the catalog so this enum can never drift from it again (it drifted in 3 lanes).
    key: z.enum(MODULE_KEYS),
    enabled: z.boolean(),
  })
  .strict();
export type SetModuleEnabledInput = z.infer<typeof SetModuleEnabledSchema>;

// M03-T8 — academic year / term / institution settings setup actions.
// `sequence` (terms) and date-ordering are not client input: the handler
// derives sequence, and `app.validate_term_dates` (0002) enforces a term
// falling inside its year.
export const AcademicYearUpsertSchema = z
  .object({
    id: uuid.optional(),
    name: shortText,
    startsOn: isoDate,
    endsOn: isoDate,
    isCurrent: z.boolean().optional(),
  })
  .strict();
export type AcademicYearUpsertInput = z.infer<typeof AcademicYearUpsertSchema>;

export const TermUpsertSchema = z
  .object({
    id: uuid.optional(),
    academicYearId: uuid,
    name: shortText,
    startsOn: isoDate,
    endsOn: isoDate,
  })
  .strict();
export type TermUpsertInput = z.infer<typeof TermUpsertSchema>;

// `settings` is a deep-partial patch validated against the real settings
// schema (same per-key-strictness idea as setFeatureEnabled's `features`
// patch): a key that's present must still be the full, valid shape for
// that key; `.partial()` only makes top-level keys optional. Modules are
// never updated via updateSettings; they go through core.module.set.
// Same for branding/setup: only the core.setup.* actions write them.
export const UpdateInstitutionSettingsSchema = z
  .object({
    name: shortText.optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    settings: InstitutionSettingsSchema.omit({ modules: true, branding: true, setup: true }).partial().optional(),
  })
  .strict();
export type UpdateInstitutionSettingsInput = z.infer<typeof UpdateInstitutionSettingsSchema>;

// Per-user home dashboard layout (dashboard_preferences.layout). Ids are the
// registry's; each list holds at most one entry per widget.
const widgetId = z.enum([...DASHBOARD_WIDGET_IDS, ...MORE_CARD_IDS]);
export const DashboardLayoutSchema = z
  .object({
    hidden: z.array(widgetId).max(DASHBOARD_WIDGET_IDS.length + MORE_CARD_IDS.length),
    order: z.array(widgetId).max(DASHBOARD_WIDGET_IDS.length + MORE_CARD_IDS.length),
  })
  .strict()
  .refine((l) => new Set(l.hidden).size === l.hidden.length && new Set(l.order).size === l.order.length, {
    message: "Each widget may appear at most once per list.",
  });
export type DashboardLayoutInput = z.infer<typeof DashboardLayoutSchema>;
