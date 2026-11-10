export type TourRoleKey = "principal" | "admin" | "teacher" | "student" | "parent";

export interface TourFeature {
  title: string;
  blurb: string;
  icon: string; // lucide-react export name
  label?: "simulated" | "limited";
}

export interface TourRole {
  key: TourRoleKey;
  label: string;
  room: string;
  tagline: string;
  demoEmail: string;
  accent: string;
  features: readonly TourFeature[];
}

const D = "@demo.coolskool.test";

export const TOUR_ROLES: readonly TourRole[] = [
  {
    key: "principal",
    label: "Principal",
    room: "Principal's office",
    tagline: "See the whole school on one dashboard and act on what needs attention.",
    demoEmail: `principal${D}`,
    accent: "#FF6B35",
    features: [
      {
        title: "School dashboard",
        blurb: "Attendance, fees, admissions and exam results for the whole school.",
        icon: "LayoutDashboard",
      },
      {
        title: "Daily briefing",
        blurb: "A short summary of approvals, attendance, fees and insights each day.",
        icon: "Sun",
        label: "limited",
      },
      {
        title: "Fee collection forecast",
        blurb: "Projects fee collection and attendance rates from past trends.",
        icon: "TrendingUp",
        label: "limited",
      },
      {
        title: "Admissions funnel",
        blurb: "Counts enquiries, applications and enrolments at each stage.",
        icon: "ClipboardList",
      },
      {
        title: "Scheduled reports",
        blurb: "Attendance and fee defaulter reports that run on a schedule.",
        icon: "Bell",
      },
      {
        title: "Early warning insights",
        blurb: "Flags attendance, marks and fee issues that need a human review.",
        icon: "Sparkles",
        label: "limited",
      },
    ],
  },
  {
    key: "admin",
    label: "Administrator",
    room: "Front office",
    tagline: "Run students, staff, fees and admissions from one front desk.",
    demoEmail: `admin${D}`,
    accent: "#7B61FF",
    features: [
      {
        title: "Students and staff",
        blurb: "Student records with admission numbers, guardians and enrolments.",
        icon: "Users",
      },
      {
        title: "Fee invoices and payments",
        blurb: "Assign fees, generate invoices and record cash, UPI or bank payments.",
        icon: "Banknote",
      },
      {
        title: "Admissions pipeline",
        blurb: "Track enquiries through stages, then offer, reject or enrol.",
        icon: "ClipboardList",
      },
      {
        title: "School website",
        blurb: "Edit public pages, notices and events, then publish them.",
        icon: "Globe",
      },
      {
        title: "Parent messages",
        blurb: "Email is sent live. SMS and WhatsApp are simulated in this demo.",
        icon: "Megaphone",
        label: "simulated",
      },
      {
        title: "Audit log",
        blurb: "A record of who changed what, kept for accountability.",
        icon: "Shield",
      },
    ],
  },
  {
    key: "teacher",
    label: "Teacher",
    room: "Classroom",
    tagline: "Mark attendance, post homework and enter marks for your classes.",
    demoEmail: `teacher.x-a${D}`,
    accent: "#00C853",
    features: [
      {
        title: "Daily attendance",
        blurb: "Mark a whole section at once and correct mistakes with a reason.",
        icon: "CalendarCheck",
      },
      {
        title: "Class diary",
        blurb: "Post homework and notes for each section.",
        icon: "NotebookPen",
      },
      {
        title: "Assignments",
        blurb: "Create assignments, publish them and grade submissions.",
        icon: "FileText",
      },
      {
        title: "Marks entry",
        blurb: "Enter marks for each exam paper, checked before results are published.",
        icon: "GraduationCap",
      },
      {
        title: "Quiz generator",
        blurb: "AI drafts a quiz from a curriculum unit. You review it before saving.",
        icon: "Bot",
        label: "limited",
      },
    ],
  },
  {
    key: "student",
    label: "Student",
    room: "Library",
    tagline: "Check your attendance, assignments and results in one place.",
    demoEmail: `student.one${D}`,
    accent: "#2979FF",
    features: [
      {
        title: "My attendance",
        blurb: "See your own attendance record for the year.",
        icon: "CalendarCheck",
        label: "limited",
      },
      {
        title: "My assignments",
        blurb: "See what is due, what you submitted and what was graded.",
        icon: "FileText",
      },
      {
        title: "My results",
        blurb: "Open your published report card for each exam.",
        icon: "GraduationCap",
      },
      {
        title: "Student portal",
        blurb: "One page for your own school details. Its layout is still basic.",
        icon: "BookOpen",
        label: "limited",
      },
      {
        title: "Notifications",
        blurb: "Messages from your school appear in your notification list.",
        icon: "Bell",
      },
    ],
  },
  {
    key: "parent",
    label: "Parent",
    room: "Parent lounge",
    tagline: "Follow your child's attendance, fees, homework and results.",
    demoEmail: `guardian.one${D}`,
    accent: "#FF2D95",
    features: [
      {
        title: "Fees and receipts",
        blurb: "See each child's fees and open a printable receipt for each payment.",
        icon: "Banknote",
      },
      {
        title: "Attendance alerts",
        blurb: "Absence notices go to you by SMS. SMS is simulated in this demo.",
        icon: "CalendarCheck",
        label: "simulated",
      },
      {
        title: "Report cards",
        blurb: "View each child's published report card. Print view only.",
        icon: "GraduationCap",
        label: "limited",
      },
      {
        title: "Class diary",
        blurb: "Read homework and notes posted by your child's teachers.",
        icon: "NotebookPen",
      },
      {
        title: "Parent meetings",
        blurb: "Book a parent-teacher meeting slot. No reminders are sent yet.",
        icon: "CalendarClock",
        label: "limited",
      },
    ],
  },
];
