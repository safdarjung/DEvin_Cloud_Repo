// Module catalog — what features exist and which are available to each institution.
// No imports (seed/jobs run this under plain node; importers use relative paths).

export type ModuleCategory =
  | 'Core'
  | 'Academics'
  | 'Exams'
  | 'Admissions & Website'
  | 'People & HR'
  | 'Finance+'
  | 'Operations'
  | 'Communication'
  | 'Reports'
  | 'AI'
  | 'Intelligence';

interface ModuleEntry {
  label: string;
  category: ModuleCategory;
  description: string;
  core?: true;
  default: boolean;
  /** Indicative INR per school per month, whole rupees. 0 for core. No billing exists. */
  priceInr: number;
  requires?: readonly string[] | undefined;
}

export const MODULES = {
  core: {
    label: 'Core',
    category: 'Core',
    description: 'Institution settings, staff/member management, documents, jobs, and AI usage tracking.',
    core: true,
    default: true,
    priceInr: 0,
  },
  people: {
    label: 'People',
    category: 'Core',
    description: 'Student and guardian profiles, admissions, staff directory.',
    core: true,
    default: true,
    priceInr: 0,
  },
  academic_structure: {
    label: 'Academic Structure',
    category: 'Core',
    description: 'Grades, sections, subjects, curriculum units, and class assignments.',
    core: true,
    default: true,
    priceInr: 0,
  },
  attendance: {
    label: 'Attendance',
    category: 'Core',
    description: 'Daily attendance marking, session tracking, and absence patterns.',
    core: true,
    default: true,
    priceInr: 0,
  },
  fees: {
    label: 'Fees',
    category: 'Core',
    description: 'Fee structures, invoicing, payment recording, and term collection reports.',
    core: true,
    default: true,
    priceInr: 0,
  },
  notifications: {
    label: 'Notifications',
    category: 'Core',
    description: 'In-app notifications, preferences, and the notification center.',
    core: true,
    default: true,
    priceInr: 0,
  },
  timetable: {
    label: 'Timetable',
    category: 'Academics',
    description: 'Class schedules, periods, and period attendance.',
    default: true,
    priceInr: 3499,
  },
  assignments: {
    label: 'Assignments',
    category: 'Academics',
    description: 'Class assignments, student submissions, and grading.',
    default: true,
    priceInr: 2499,
  },
  lesson_plans: {
    label: 'Lesson Plans',
    category: 'Academics',
    description: 'Curriculum lesson plans and coverage tracking by section.',
    default: true,
    priceInr: 2499,
  },
  question_bank: {
    label: 'Question Bank',
    category: 'Academics',
    description: 'Question library for exam and quiz creation.',
    default: true,
    priceInr: 2499,
  },
  exams: {
    label: 'Exams',
    category: 'Exams',
    description: 'Exam schedules, papers, results, and rechecks.',
    default: true,
    priceInr: 3499,
  },
  exam_seating: {
    label: 'Exam seating & admit cards',
    category: 'Exams',
    description: 'Seat students across exam rooms and print room charts and admit cards.',
    default: false,
    priceInr: 1499,
    requires: ['exams'],
  },
  admissions: {
    label: 'Admissions',
    category: 'Admissions & Website',
    description: 'Enquiry forms, admission stages, and enrolment workflow.',
    default: true,
    priceInr: 3499,
  },
  website: {
    label: 'Website',
    category: 'Admissions & Website',
    description: 'Public school website with content pages and gallery.',
    default: true,
    priceInr: 3499,
  },
  staff_attendance: {
    label: 'Staff Attendance',
    category: 'People & HR',
    description: 'Staff attendance, leave requests, and leave approvals.',
    default: true,
    priceInr: 3499,
  },
  substitution: {
    label: 'Substitution',
    category: 'People & HR',
    description: 'Class substitution and cover assignments.',
    default: true,
    priceInr: 2499,
    requires: ['staff_attendance', 'timetable'],
  },
  student_lifecycle: {
    label: 'Student Lifecycle',
    category: 'People & HR',
    description: 'Student promotion, transfer, and withdrawal tracking.',
    default: true,
    priceInr: 3499,
  },
  certificates: {
    label: 'Certificates & ID cards',
    category: 'People & HR',
    description: 'Issue bonafide, character and transfer certificates with serial numbers, and print student ID cards.',
    default: true,
    priceInr: 1499,
  },
  finance_plus: {
    label: 'Finance+',
    category: 'Finance+',
    description: 'Payment reversals, reminders, and collection reporting.',
    default: true,
    priceInr: 3499,
  },
  online_payments: {
    label: 'Online Payments',
    category: 'Finance+',
    description: 'Razorpay integration for online fee payment.',
    default: true,
    priceInr: 3499,
    requires: ['finance_plus'],
  },
  fee_plans: {
    label: 'Late fees & instalments',
    category: 'Finance+',
    description: 'Late-fee rules, instalment plans for term invoices, and Tally/CSV ledger export.',
    default: true,
    priceInr: 3499,
    requires: ['finance_plus'],
  },
  facilities: {
    label: 'Facilities',
    category: 'Operations',
    description: 'Room inventory, asset management, and maintenance requests.',
    default: true,
    priceInr: 2499,
  },
  transport: {
    label: 'Transport',
    category: 'Operations',
    description: 'Transport routes, vehicle allocation, and student tracking.',
    default: true,
    priceInr: 2499,
  },
  calendar: {
    label: 'Calendar',
    category: 'Operations',
    description: 'Academic calendar, holidays, and attendance blocking.',
    default: true,
    priceInr: 1499,
  },
  library: {
    label: 'Library',
    category: 'Operations',
    description: 'Book catalogue with accession numbers, issue, renew and return, overdue list, and fines added to the fee invoice.',
    default: false,
    priceInr: 2499,
  },
  visitors: {
    label: 'Visitors & gate pass',
    category: 'Operations',
    description: 'Front-desk visitor log, student early-leave gate passes and guardian-maintained pickup lists.',
    default: false,
    priceInr: 1499,
  },
  announcements: {
    label: 'Announcements',
    category: 'Communication',
    description: 'School announcements and broadcast messaging.',
    default: true,
    priceInr: 1499,
  },
  email: {
    label: 'Email',
    category: 'Communication',
    description: 'Email delivery channel for notifications and invitations.',
    default: true,
    priceInr: 1499,
  },
  sms: {
    label: 'SMS',
    category: 'Communication',
    description: 'SMS delivery channel for notifications.',
    default: true,
    priceInr: 2499,
  },
  whatsapp: {
    label: 'WhatsApp',
    category: 'Communication',
    description: 'Sends parent alerts on WhatsApp through MSG91 approved templates; simulated until the provider key is set.',
    default: true,
    priceInr: 3499,
  },
  ptm: {
    label: 'PTM booking & surveys',
    category: 'Communication',
    description: 'Parent-teacher meeting slot booking and short parent surveys with aggregate results.',
    default: false,
    priceInr: 2499,
  },
  student_leave: {
    label: 'Student leave',
    category: 'Communication',
    description: 'Parents apply for their child\'s leave; the class teacher approves and attendance is pre-marked.',
    default: true,
    priceInr: 1499,
  },
  diary: {
    label: 'Class diary',
    category: 'Communication',
    description: 'Teachers post daily homework and notes per class; parents read and acknowledge.',
    default: true,
    priceInr: 1499,
  },
  messaging: {
    label: 'Parent-teacher messaging',
    category: 'Communication',
    description: 'Guardians and teachers exchange private messages about a student.',
    default: true,
    priceInr: 3499,
  },
  practice: {
    label: 'Student practice',
    category: 'Academics',
    description: 'Students take AI-generated practice quizzes per curriculum unit and track progress.',
    default: true,
    priceInr: 2499,
  },
  scheduled_reports: {
    label: 'Scheduled Reports',
    category: 'Reports',
    description: 'Automated report generation and delivery on a schedule.',
    default: false,
    priceInr: 3499,
  },
  ai_teacher: {
    label: 'AI Teacher',
    category: 'AI',
    description: 'AI-powered quiz generation, insights, and lesson planning.',
    default: true,
    priceInr: 4999,
  },
  ai_student: {
    label: 'AI Student',
    category: 'AI',
    description: 'AI-powered study resources and personalized learning paths.',
    default: true,
    priceInr: 4999,
  },
  ai_briefings: {
    label: 'AI Briefings',
    category: 'AI',
    description: 'AI-generated dashboard briefings and attendance insights.',
    default: true,
    priceInr: 4999,
  },
  insights: {
    label: 'Insights',
    category: 'Intelligence',
    description: 'Student progress analytics and learning insights.',
    default: false,
    priceInr: 4999,
  },
  mastery: {
    label: 'Mastery',
    category: 'Intelligence',
    description: 'Competency mastery tracking and progression models.',
    default: false,
    priceInr: 4999,
    requires: ['exams'],
  },
  forecasts: {
    label: 'Forecasts',
    category: 'Intelligence',
    description: 'Student performance and outcome forecasting.',
    default: false,
    priceInr: 4999,
  },
  agents: {
    label: 'Agents',
    category: 'Intelligence',
    description: 'Autonomous agents for automated school operations.',
    default: false,
    priceInr: 4999,
    requires: ['ai_teacher'],
  },
  workflows: {
    label: 'Workflows',
    category: 'Intelligence',
    description: 'Workflow automation and business process orchestration.',
    default: false,
    priceInr: 4999,
  },
  behaviour: {
    label: 'Behaviour',
    category: 'People & HR',
    description: 'Behaviour incident log with categories, severity and merit/demerit points; void instead of delete.',
    default: true,
    priceInr: 2499,
  },
  health: {
    label: 'Health',
    category: 'People & HR',
    description: 'Student health profiles, sick-room visits and vaccination records; guardians see their own child.',
    default: true,
    priceInr: 2499,
  },
  clubs: {
    label: 'Clubs & houses',
    category: 'Academics',
    description: 'Clubs, house system with house points, club events and student sign-ups.',
    default: true,
    priceInr: 1499,
  },
  hostel: {
    label: 'Hostel',
    category: 'Operations',
    description: 'Hostel rooms, bed allocations and nightly roll calls.',
    default: true,
    priceInr: 2499,
  },
  school_labs: {
    label: 'School Labs',
    category: 'Operations',
    description: 'Science, computer and language lab bookings, equipment and chemical stock, experiment log and incidents.',
    default: true,
    priceInr: 2499,
  },
  achievements: {
    label: 'Achievements',
    category: 'Academics',
    description: 'Student achievements portfolio with verification and a printable record.',
    default: true,
    priceInr: 1499,
  },
  safety: {
    label: 'Safety alerts',
    category: 'Operations',
    description: 'Emergency alerts, drills and closures with acknowledgements and section headcounts.',
    default: true,
    priceInr: 2499,
  },
  compliance: {
    label: 'Compliance tracker',
    category: 'Operations',
    description: 'Affiliation, safety and statutory renewals with due dates and renewal history.',
    default: true,
    priceInr: 2499,
  },
  resources: {
    label: 'Learning resources',
    category: 'Academics',
    description: 'Links, files and notes shared with the sections you teach.',
    default: true,
    priceInr: 2499,
  },
  duties: {
    label: 'Duty roster',
    category: 'People & HR',
    description: 'Staff duty types, fair-rotation roster and swap requests.',
    default: true,
    priceInr: 2499,
  },
  expenses: {
    label: 'Expenses',
    category: 'Finance+',
    description: 'Expense register by category with budgets; a separate register, not posted to the fee ledger.',
    default: true,
    priceInr: 3499,
  },
  scholarships: {
    label: 'Scholarships & concessions',
    category: 'Finance+',
    description: 'Concession rules and award requests with a separate approver.',
    default: true,
    priceInr: 3499,
  },
  canteen: {
    label: 'Canteen',
    category: 'Operations',
    description: 'Canteen menu, prepaid wallet top-ups and purchases; balance computed from transactions.',
    default: true,
    priceInr: 2499,
  },
  inventory: {
    label: 'Inventory',
    category: 'Operations',
    description: 'Stock items with reorder levels; stock in, issue, return and adjustment movements.',
    default: true,
    priceInr: 2499,
  },
  helpdesk: {
    label: 'Helpdesk',
    category: 'Communication',
    description: 'Tickets raised by parents, students and teachers, with priority due dates and replies.',
    default: true,
    priceInr: 2499,
  },
  forms: {
    label: 'Forms & consent',
    category: 'Communication',
    description: 'Custom forms and consent slips sent to sections; one response per respondent and student.',
    default: true,
    priceInr: 2499,
  },
  alumni: {
    label: 'Alumni',
    category: 'People & HR',
    description: 'Alumni directory built from students who exited the school, with batch year and contact.',
    default: true,
    priceInr: 1499,
  },
  payroll: {
    label: 'Payroll',
    category: 'People & HR',
    description: 'Salary structures, monthly payroll runs and payslips; no bank payout or statutory deductions.',
    default: true,
    priceInr: 3499,
  },
} as const satisfies Record<string, ModuleEntry>;

export type ModuleKey = keyof typeof MODULES;
export type OptionalModuleKey = Exclude<ModuleKey, 'core' | 'people' | 'academic_structure' | 'attendance' | 'fees' | 'notifications'>;

export const MODULE_KEYS: [ModuleKey, ...ModuleKey[]] = [
  'core',
  'people',
  'academic_structure',
  'attendance',
  'fees',
  'notifications',
  'timetable',
  'assignments',
  'lesson_plans',
  'question_bank',
  'exams',
  'exam_seating',
  'admissions',
  'website',
  'staff_attendance',
  'substitution',
  'student_lifecycle',
  'certificates',
  'finance_plus',
  'online_payments',
  'fee_plans',
  'facilities',
  'transport',
  'calendar',
  'library',
  'visitors',
  'announcements',
  'email',
  'sms',
  'whatsapp',
  'ptm',
  'student_leave',
  'diary',
  'messaging',
  'practice',
  'scheduled_reports',
  'ai_teacher',
  'ai_student',
  'ai_briefings',
  'insights',
  'mastery',
  'forecasts',
  'agents',
  'workflows',
  'behaviour',
  'health',
  'clubs',
  'hostel',
  'school_labs',
  'achievements',
  'safety',
  'compliance',
  'resources',
  'duties',
  'expenses',
  'scholarships',
  'canteen',
  'inventory',
  'helpdesk',
  'forms',
  'alumni',
  'payroll',
];

export const OPTIONAL_MODULE_KEYS: [OptionalModuleKey, ...OptionalModuleKey[]] = [
  'timetable',
  'assignments',
  'lesson_plans',
  'question_bank',
  'exams',
  'exam_seating',
  'admissions',
  'website',
  'staff_attendance',
  'substitution',
  'student_lifecycle',
  'certificates',
  'finance_plus',
  'online_payments',
  'fee_plans',
  'facilities',
  'transport',
  'calendar',
  'library',
  'visitors',
  'announcements',
  'email',
  'sms',
  'whatsapp',
  'ptm',
  'student_leave',
  'diary',
  'messaging',
  'practice',
  'scheduled_reports',
  'ai_teacher',
  'ai_student',
  'ai_briefings',
  'insights',
  'mastery',
  'forecasts',
  'agents',
  'workflows',
  'behaviour',
  'health',
  'clubs',
  'hostel',
  'school_labs',
  'achievements',
  'safety',
  'compliance',
  'resources',
  'duties',
  'expenses',
  'scholarships',
  'canteen',
  'inventory',
  'helpdesk',
  'forms',
  'alumni',
  'payroll',
];

export const MODULE_DISABLED_MESSAGE = 'Module not enabled for this school.';

// Defensive read like isFeatureEnabled (D33 pattern)
export function isModuleEnabled(
  ctx: { institution: { settings?: Record<string, unknown> | null } },
  key: ModuleKey
): boolean {
  const entry = MODULES[key] as Record<string, unknown>;

  // Core modules are always enabled
  if (entry.core === true) {
    return true;
  }

  // Check requires recursively
  const requires = entry.requires;
  if (requires && Array.isArray(requires)) {
    for (const req of requires) {
      if (!isModuleEnabled(ctx, req as ModuleKey)) {
        return false;
      }
    }
  }

  // Read stored value defensively
  const settings = ctx.institution.settings;
  const modules = typeof settings === 'object' && settings !== null ? (settings as Record<string, unknown>).modules : undefined;
  const stored = typeof modules === 'object' && modules !== null ? (modules as Record<string, unknown>)[key] : undefined;

  if (typeof stored === 'boolean') {
    return stored;
  }

  return (entry as Record<string, unknown>).default as boolean;
}

// All optional modules enabled
export function allModulesOn(): Record<OptionalModuleKey, true> {
  const result: Record<string, true> = {};
  for (const key of OPTIONAL_MODULE_KEYS) {
    result[key] = true;
  }
  return result as Record<OptionalModuleKey, true>;
}

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const PRICE_NOTE = 'Indicative price. Installing does not charge anything yet.';
export function formatPriceInr(priceInr: number): string {
  return priceInr === 0 ? 'Included' : `${INR.format(priceInr)} / month`;
}

// Indicative monthly total (whole INR) of enabled non-core modules. Core is 0.
export function monthlyTotalInr(ctx: { institution: { settings?: Record<string, unknown> | null } }): number {
  return MODULE_KEYS.reduce((sum, key) => (isModuleEnabled(ctx, key) ? sum + MODULES[key].priceInr : sum), 0);
}
