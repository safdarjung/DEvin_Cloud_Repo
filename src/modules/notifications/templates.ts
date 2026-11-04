// T-038 — notification types and templates (06 §3). Each type carries its
// channel list (per the spec table) and a Zod-validated variable schema so
// a handler can never render free-form payload text into a message body.
import { z } from "zod";

export type NotificationChannel = "in_app" | "sms" | "email";
export type Lang = "en" | "hi";

// M06-T3 — `notification_preferences.category` check (0068). `createNotification`
// looks up the recipient's disabled sms/email prefs for a template's category.
export type NotificationCategory = "attendance" | "academic" | "admissions" | "announcement" | "report";

export const NOTIFICATION_TYPES = [
  "attendance_absence",
  "results_published",
  "recheck_decided",
  "enquiry_received",
  "enrolment_welcome",
  "announcement",
  "report_ready",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const AttendanceAbsenceVars = z
  .object({ student: z.string().min(1), class: z.string().min(1), date: z.string().min(1), school: z.string().min(1) })
  .strict();

const ResultsPublishedVars = z
  .object({ student: z.string().min(1), exam: z.string().min(1), school: z.string().min(1) })
  .strict();

const RecheckDecidedVars = z
  .object({
    student: z.string().min(1),
    subject: z.string().min(1),
    decision: z.string().min(1),
    marks: z.string().min(1),
    school: z.string().min(1),
  })
  .strict();

const EnquiryReceivedVars = z
  .object({ child: z.string().min(1), grade: z.string().min(1), guardian: z.string().min(1) })
  .strict();

const EnrolmentWelcomeVars = z
  .object({ student: z.string().min(1), class: z.string().min(1), admission_no: z.string().min(1) })
  .strict();

const AnnouncementVars = z.object({ title: z.string().min(1), excerpt: z.string().min(1) }).strict();

const ReportReadyVars = z.object({ report: z.string().min(1).max(80), date: z.string().min(1).max(20) }).strict();

export interface TemplateDef<V> {
  channels: readonly NotificationChannel[];
  category: NotificationCategory;
  varsSchema: z.ZodType<V>;
  title(lang: Lang): string;
  body(vars: V, lang: Lang): string;
}

function def<V>(t: TemplateDef<V>): TemplateDef<V> {
  return t;
}

// Not typed as `Record<NotificationType, TemplateDef<unknown>>`: that would
// require every `body(vars: V, ...)` method to accept `unknown`, which
// defeats the per-type vars schema. `tests/unit/notification-templates.test.ts`
// asserts every `NOTIFICATION_TYPES` entry has a template at runtime instead.
export const NOTIFICATION_TEMPLATES = {
  attendance_absence: def({
    channels: ["in_app", "sms"],
    category: "attendance",
    varsSchema: AttendanceAbsenceVars,
    title: (lang) => (lang === "hi" ? "उपस्थिति: अनुपस्थित" : "Attendance: Absent"),
    body: (v, lang) =>
      lang === "hi"
        ? `प्रिय अभिभावक, ${v.student} (${v.class}) आज ${v.date} अनुपस्थित है। अनियोजित होने पर कक्षा शिक्षक से संपर्क करें। -${v.school}`
        : `Dear Parent, ${v.student} (${v.class}) is marked absent today ${v.date}. Contact the class teacher if unplanned. -${v.school}`,
  }),
  results_published: def({
    channels: ["in_app", "sms"],
    category: "academic",
    varsSchema: ResultsPublishedVars,
    title: (lang) => (lang === "hi" ? "रिपोर्ट कार्ड प्रकाशित" : "Report card published"),
    body: (v, lang) =>
      lang === "hi"
        ? `${v.student} की ${v.exam} की रिपोर्ट कार्ड अब पेरेंट पोर्टल में उपलब्ध है। -${v.school}`
        : `Report card of ${v.student} for ${v.exam} is now available in the parent portal. -${v.school}`,
  }),
  recheck_decided: def({
    channels: ["in_app", "sms"],
    category: "academic",
    varsSchema: RecheckDecidedVars,
    title: (lang) => (lang === "hi" ? "रीचेक निर्णय" : "Recheck decision"),
    body: (v, lang) =>
      lang === "hi"
        ? `${v.student}, ${v.subject} के लिए रीचेक: ${v.decision}। नए अंक: ${v.marks}। -${v.school}`
        : `Recheck for ${v.student}, ${v.subject}: ${v.decision}. Updated marks: ${v.marks}. -${v.school}`,
  }),
  enquiry_received: def({
    channels: ["in_app"],
    category: "admissions",
    varsSchema: EnquiryReceivedVars,
    title: (lang) => (lang === "hi" ? "नई प्रवेश पूछताछ" : "New admissions enquiry"),
    body: (v, lang) =>
      lang === "hi"
        ? `नई पूछताछ: ${v.grade} के लिए ${v.child}, अभिभावक ${v.guardian}।`
        : `New enquiry: ${v.child} for ${v.grade} from ${v.guardian}.`,
  }),
  enrolment_welcome: def({
    channels: ["in_app", "email"],
    category: "admissions",
    varsSchema: EnrolmentWelcomeVars,
    title: (lang) => (lang === "hi" ? "स्वागत है!" : "Welcome!"),
    body: (v, lang) =>
      lang === "hi"
        ? `स्वागत है! ${v.student} को ${v.class} में दाखिला मिला। प्रवेश क्रमांक ${v.admission_no}।`
        : `Welcome! ${v.student} is enrolled in ${v.class}. Admission no ${v.admission_no}.`,
  }),
  announcement: def({
    channels: ["in_app", "sms", "email"],
    category: "announcement",
    varsSchema: AnnouncementVars,
    title: (lang) => (lang === "hi" ? "नई सूचना" : "New announcement"),
    body: (v, lang) => (lang === "hi" ? `सूचना: ${v.title} - ${v.excerpt}` : `${v.title}: ${v.excerpt}`),
  }),
  report_ready: def({
    channels: ["in_app"],
    category: "report",
    varsSchema: ReportReadyVars,
    title: (lang) => (lang === "hi" ? "रिपोर्ट तैयार" : "Report ready"),
    body: (v, lang) =>
      lang === "hi"
        ? `${v.report} (${v.date}) डाउनलोड के लिए तैयार है।`
        : `${v.report} for ${v.date} is ready to download.`,
  }),
} satisfies Record<NotificationType, TemplateDef<unknown>>;

export type VarsFor<T extends NotificationType> = (typeof NOTIFICATION_TEMPLATES)[T] extends TemplateDef<infer V>
  ? V
  : never;
