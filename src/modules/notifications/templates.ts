// T-038 — notification types and templates (06 §3). Each type carries its
// channel list (per the spec table) and a Zod-validated variable schema so
// a handler can never render free-form payload text into a message body.
import { z } from "zod";

export type NotificationChannel = "in_app" | "sms" | "email" | "whatsapp";
export type Lang = "en" | "hi";

// M06-T3 — `notification_preferences.category` check (0068). `createNotification`
// looks up the recipient's disabled sms/email prefs for a template's category.
export type NotificationCategory = "attendance" | "academic" | "admissions" | "announcement" | "report" | "finance";

export const NOTIFICATION_TYPES = [
  "attendance_absence",
  "results_published",
  "recheck_decided",
  "enquiry_received",
  "enrolment_welcome",
  "announcement",
  "gate_pass_approved",
  "report_ready",
  "fee_reminder",
  "student_leave_decided",
  "diary_entry",
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

// X07-T7 — gate pass approval notice (rulings "Notification").
const GatePassApprovedVars = z
  .object({
    student: z.string().min(1),
    class: z.string().min(1),
    collector: z.string().min(1),
    time: z.string().min(1),
// X01-T10 — no `reason`/`decision_note` var (lesson 10: never notify the
// leave's own reason, it may hold health details).
const StudentLeaveDecidedVars = z
  .object({
    student: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    decision: z.string().min(1),
    school: z.string().min(1),
  })
  .strict();

const ReportReadyVars = z.object({ report: z.string().min(1).max(80), date: z.string().min(1).max(20) }).strict();
const FeeReminderVars = z
  .object({
    student: z.string().min(1),
    invoice_no: z.string().min(1),
    amount: z.string().min(1),
    due_on: z.string().min(1),
    school: z.string().min(1),
  })
const DiaryEntryVars = z
  .object({ section: z.string().min(1), subject: z.string().min(1), excerpt: z.string().min(1) })
  .strict();

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
    channels: ["in_app", "sms", "whatsapp"],
    category: "attendance",
    varsSchema: AttendanceAbsenceVars,
    title: (lang) => (lang === "hi" ? "उपस्थिति: अनुपस्थित" : "Attendance: Absent"),
    body: (v, lang) =>
      lang === "hi"
        ? `प्रिय अभिभावक, ${v.student} (${v.class}) आज ${v.date} अनुपस्थित है। अनियोजित होने पर कक्षा शिक्षक से संपर्क करें। -${v.school}`
        : `Dear Parent, ${v.student} (${v.class}) is marked absent today ${v.date}. Contact the class teacher if unplanned. -${v.school}`,
  }),
  results_published: def({
    channels: ["in_app", "sms", "whatsapp"],
    category: "academic",
    varsSchema: ResultsPublishedVars,
    title: (lang) => (lang === "hi" ? "रिपोर्ट कार्ड प्रकाशित" : "Report card published"),
    body: (v, lang) =>
      lang === "hi"
        ? `${v.student} की ${v.exam} की रिपोर्ट कार्ड अब पेरेंट पोर्टल में उपलब्ध है। -${v.school}`
        : `Report card of ${v.student} for ${v.exam} is now available in the parent portal. -${v.school}`,
  }),
  recheck_decided: def({
    channels: ["in_app", "sms", "whatsapp"],
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
    channels: ["in_app", "sms", "whatsapp", "email"],
    category: "announcement",
    varsSchema: AnnouncementVars,
    title: (lang) => (lang === "hi" ? "नई सूचना" : "New announcement"),
    body: (v, lang) => (lang === "hi" ? `सूचना: ${v.title} - ${v.excerpt}` : `${v.title}: ${v.excerpt}`),
  }),
  gate_pass_approved: def({
    channels: ["in_app", "sms"],
    category: "attendance",
    varsSchema: GatePassApprovedVars,
    title: (lang) => (lang === "hi" ? "गेट पास स्वीकृत" : "Gate pass approved"),
    body: (v, lang) =>
      lang === "hi"
        ? `गेट पास: ${v.student} (${v.class}) आज स्कूल से जल्दी जा सकते हैं ${v.collector} के साथ, स्वीकृत ${v.time}। अप्रत्याशित है? अभी स्कूल को कॉल करें। -${v.school}`
        : `Gate pass: ${v.student} (${v.class}) may leave school early today with ${v.collector}, approved ${v.time}. Not expected? Call the school now. -${v.school}`,
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
  fee_reminder: def({
    channels: ["in_app", "sms", "whatsapp", "email"],
    category: "finance",
    varsSchema: FeeReminderVars,
    title: (lang) => (lang === "hi" ? "शुल्क अनुस्मारक" : "Fee reminder"),
    body: (v, lang) =>
      lang === "hi"
        ? `शुल्क अनुस्मारक: ${v.student} के लिए ${v.amount} बकाया है (चालान ${v.invoice_no}, देय तिथि ${v.due_on})। कृपया विद्यालय कार्यालय में भुगतान करें। -${v.school}`
        : `Fee reminder: ${v.amount} is due for ${v.student} (invoice ${v.invoice_no}, due ${v.due_on}). Please pay at the school office. -${v.school}`,
  student_leave_decided: def({
    channels: ["in_app", "sms"],
    category: "attendance",
    varsSchema: StudentLeaveDecidedVars,
    title: (lang) => (lang === "hi" ? "अवकाश निर्णय" : "Leave decision"),
    body: (v, lang) =>
      lang === "hi"
        ? `${v.student} का अवकाश (${v.from} से ${v.to}) ${v.decision} कर दिया गया है। -${v.school}`
        : `${v.student}'s leave (${v.from} to ${v.to}) has been ${v.decision}. -${v.school}`,
  }),
  diary_entry: def({
    channels: ["in_app"],
    category: "academic",
    varsSchema: DiaryEntryVars,
    title: (lang) => (lang === "hi" ? "नई डायरी प्रविष्टि" : "New diary entry"),
    body: (v, lang) =>
      lang === "hi"
        ? `${v.section} (${v.subject}): ${v.excerpt}`
        : `${v.section} (${v.subject}): ${v.excerpt}`,
  }),
} satisfies Record<NotificationType, TemplateDef<unknown>>;

export type VarsFor<T extends NotificationType> = (typeof NOTIFICATION_TEMPLATES)[T] extends TemplateDef<infer V>
  ? V
  : never;

// X05-T2 (D42) — WhatsApp (MSG91 approved templates). Only the sms-channel
// types get an approved WhatsApp template; `enquiry_received` (staff, in_app
// only) and `enrolment_welcome` (handler passes only an email) do not.
export type WhatsAppType = "attendance_absence" | "results_published" | "recheck_decided" | "announcement" | "fee_reminder";

export const WHATSAPP_PARAMS: { readonly [T in WhatsAppType]: readonly (keyof VarsFor<T> & string)[] } = {
  attendance_absence: ["student", "class", "date", "school"],
  results_published: ["student", "exam", "school"],
  recheck_decided: ["student", "subject", "decision", "marks", "school"],
  announcement: ["title", "excerpt"],
  fee_reminder: ["student", "invoice_no", "amount", "due_on", "school"],
};

const WHATSAPP_HEADING: Record<Lang, string> = { en: "School update", hi: "स्कूल अपडेट" };
const WHATSAPP_CLOSING: Record<Lang, string> = {
  en: "Details are in the CoolSkool app.",
  hi: "विवरण CoolSkool ऐप में देखें।",
};

// Meta rejects a param with a newline, a tab, more than one run of spaces or
// an empty value — collapse whitespace and fall back to "-" (rulings "Params").
function sanitizeWhatsAppParam(value: unknown): string {
  const cleaned = String(value).replace(/\s+/g, " ").trim().slice(0, 300);
  return cleaned || "-";
}

function wrapWhatsAppBody(body: string, lang: Lang): string {
  return `${WHATSAPP_HEADING[lang]}\n${body}\n\n${WHATSAPP_CLOSING[lang]}`;
}

export function whatsappMessage<T extends WhatsAppType>(
  type: T,
  vars: VarsFor<T>,
  lang: Lang,
): { template: { name: string; lang: Lang; params: string[] }; text: string } {
  const def = NOTIFICATION_TEMPLATES[type] as TemplateDef<VarsFor<T>>;
  const params = WHATSAPP_PARAMS[type].map((key) => sanitizeWhatsAppParam((vars as Record<string, unknown>)[key]));
  return {
    template: { name: `coolskool_${type}`, lang, params },
    text: wrapWhatsAppBody(def.body(vars, lang), lang),
  };
}

// Same wrapper, with each param key replaced by its `{{n}}` placeholder —
// this is the text ops submits to Meta for template approval (rulings
// "Template text"). Never starts/ends with `{{`: the heading/closing wrap.
export function whatsappApprovalText(type: WhatsAppType, lang: Lang): string {
  const def = NOTIFICATION_TEMPLATES[type] as TemplateDef<Record<string, unknown>>;
  const placeholderVars = Object.fromEntries(WHATSAPP_PARAMS[type].map((key, i) => [key, `{{${i + 1}}}`]));
  return wrapWhatsAppBody(def.body(placeholderVars, lang), lang);
}
