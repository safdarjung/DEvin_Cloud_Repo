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
  requires?: readonly string[] | undefined;
}

export const MODULES = {
  core: {
    label: 'Core',
    category: 'Core',
    description: 'Institution settings, staff/member management, documents, jobs, and AI usage tracking.',
    core: true,
    default: true,
  },
  people: {
    label: 'People',
    category: 'Core',
    description: 'Student and guardian profiles, admissions, staff directory.',
    core: true,
    default: true,
  },
  academic_structure: {
    label: 'Academic Structure',
    category: 'Core',
    description: 'Grades, sections, subjects, curriculum units, and class assignments.',
    core: true,
    default: true,
  },
  attendance: {
    label: 'Attendance',
    category: 'Core',
    description: 'Daily attendance marking, session tracking, and absence patterns.',
    core: true,
    default: true,
  },
  fees: {
    label: 'Fees',
    category: 'Core',
    description: 'Fee structures, invoicing, payment recording, and term collection reports.',
    core: true,
    default: true,
  },
  notifications: {
    label: 'Notifications',
    category: 'Core',
    description: 'In-app notifications, preferences, and the notification center.',
    core: true,
    default: true,
  },
  timetable: {
    label: 'Timetable',
    category: 'Academics',
    description: 'Class schedules, periods, and period attendance.',
    default: true,
  },
  assignments: {
    label: 'Assignments',
    category: 'Academics',
    description: 'Class assignments, student submissions, and grading.',
    default: true,
  },
  lesson_plans: {
    label: 'Lesson Plans',
    category: 'Academics',
    description: 'Curriculum lesson plans and coverage tracking by section.',
    default: true,
  },
  question_bank: {
    label: 'Question Bank',
    category: 'Academics',
    description: 'Question library for exam and quiz creation.',
    default: true,
  },
  exams: {
    label: 'Exams',
    category: 'Exams',
    description: 'Exam schedules, papers, results, and rechecks.',
    default: true,
  },
  exam_seating: {
    label: 'Exam seating & admit cards',
    category: 'Exams',
    description: 'Seat students across exam rooms and print room charts and admit cards.',
    default: false,
    requires: ['exams'],
  },
  admissions: {
    label: 'Admissions',
    category: 'Admissions & Website',
    description: 'Enquiry forms, admission stages, and enrolment workflow.',
    default: true,
  },
  website: {
    label: 'Website',
    category: 'Admissions & Website',
    description: 'Public school website with content pages and gallery.',
    default: true,
  },
  staff_attendance: {
    label: 'Staff Attendance',
    category: 'People & HR',
    description: 'Staff attendance, leave requests, and leave approvals.',
    default: true,
  },
  substitution: {
    label: 'Substitution',
    category: 'People & HR',
    description: 'Class substitution and cover assignments.',
    default: true,
    requires: ['staff_attendance', 'timetable'],
  },
  student_lifecycle: {
    label: 'Student Lifecycle',
    category: 'People & HR',
    description: 'Student promotion, transfer, and withdrawal tracking.',
    default: true,
  },
  certificates: {
    label: 'Certificates & ID cards',
    category: 'People & HR',
    description: 'Issue bonafide, character and transfer certificates with serial numbers, and print student ID cards.',
    default: true,
  },
  finance_plus: {
    label: 'Finance+',
    category: 'Finance+',
    description: 'Payment reversals, reminders, and collection reporting.',
    default: true,
  },
  online_payments: {
    label: 'Online Payments',
    category: 'Finance+',
    description: 'Razorpay integration for online fee payment.',
    default: true,
    requires: ['finance_plus'],
  },
  fee_plans: {
    label: 'Late fees & instalments',
    category: 'Finance+',
    description: 'Late-fee rules, instalment plans for term invoices, and Tally/CSV ledger export.',
    default: true,
    requires: ['finance_plus'],
  },
  facilities: {
    label: 'Facilities',
    category: 'Operations',
    description: 'Room inventory, asset management, and maintenance requests.',
    default: true,
  },
  transport: {
    label: 'Transport',
    category: 'Operations',
    description: 'Transport routes, vehicle allocation, and student tracking.',
    default: true,
  },
  calendar: {
    label: 'Calendar',
    category: 'Operations',
    description: 'Academic calendar, holidays, and attendance blocking.',
    default: true,
  },
  library: {
    label: 'Library',
    category: 'Operations',
    description: 'Book catalogue with accession numbers, issue, renew and return, overdue list, and fines added to the fee invoice.',
    default: false,
  },
  announcements: {
    label: 'Announcements',
    category: 'Communication',
    description: 'School announcements and broadcast messaging.',
    default: true,
  },
  email: {
    label: 'Email',
    category: 'Communication',
    description: 'Email delivery channel for notifications and invitations.',
    default: true,
  },
  sms: {
    label: 'SMS',
    category: 'Communication',
    description: 'SMS delivery channel for notifications.',
    default: true,
  },
  whatsapp: {
    label: 'WhatsApp',
    category: 'Communication',
    description: 'Sends parent alerts on WhatsApp through MSG91 approved templates; simulated until the provider key is set.',
    default: true,
  },
  scheduled_reports: {
    label: 'Scheduled Reports',
    category: 'Reports',
    description: 'Automated report generation and delivery on a schedule.',
    default: false,
  },
  ai_teacher: {
    label: 'AI Teacher',
    category: 'AI',
    description: 'AI-powered quiz generation, insights, and lesson planning.',
    default: true,
  },
  ai_student: {
    label: 'AI Student',
    category: 'AI',
    description: 'AI-powered study resources and personalized learning paths.',
    default: true,
  },
  ai_briefings: {
    label: 'AI Briefings',
    category: 'AI',
    description: 'AI-generated dashboard briefings and attendance insights.',
    default: true,
  },
  insights: {
    label: 'Insights',
    category: 'Intelligence',
    description: 'Student progress analytics and learning insights.',
    default: false,
  },
  mastery: {
    label: 'Mastery',
    category: 'Intelligence',
    description: 'Competency mastery tracking and progression models.',
    default: false,
    requires: ['exams'],
  },
  forecasts: {
    label: 'Forecasts',
    category: 'Intelligence',
    description: 'Student performance and outcome forecasting.',
    default: false,
  },
  agents: {
    label: 'Agents',
    category: 'Intelligence',
    description: 'Autonomous agents for automated school operations.',
    default: false,
    requires: ['ai_teacher'],
  },
  workflows: {
    label: 'Workflows',
    category: 'Intelligence',
    description: 'Workflow automation and business process orchestration.',
    default: false,
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
  'announcements',
  'email',
  'sms',
  'whatsapp',
  'scheduled_reports',
  'ai_teacher',
  'ai_student',
  'ai_briefings',
  'insights',
  'mastery',
  'forecasts',
  'agents',
  'workflows',
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
  'announcements',
  'email',
  'sms',
  'whatsapp',
  'scheduled_reports',
  'ai_teacher',
  'ai_student',
  'ai_briefings',
  'insights',
  'mastery',
  'forecasts',
  'agents',
  'workflows',
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
