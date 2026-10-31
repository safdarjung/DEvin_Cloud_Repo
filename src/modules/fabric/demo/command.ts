import type { DailyBrief, PriorityAction, ForecastCard, RiskIndicator } from "@/modules/fabric/types";
import {
  rng,
  isoDate,
  addDays,
  INDIAN_FIRST_NAMES,
  INDIAN_LAST_NAMES,
  SECTION_LABELS,
  SUBJECTS,
  type FixtureOpts,
} from "./prng";

export function dailyBrief(
  opts: FixtureOpts,
  role: "principal" | "teacher" | "guardian" | "student"
): DailyBrief {
  const r = rng(opts.seed ?? 7);
  const date = isoDate(opts.now);

  const roleHeadlines: Record<typeof role, string> = {
    principal: "Dashboard: Operations & Insights",
    teacher: "Class Updates & Assessments",
    guardian: "Your Child's Progress",
    student: "Learning Dashboard",
  };

  const items: DailyBrief["items"] = [];

  if (role === "principal") {
    items.push(
      {
        text: `Attendance across school at ${88 + r.int(-3, 5)}%. ${r.pick(["Steady", "Slight dip observed"])} from last week.`,
        insight_id: r.id("ins", 1),
        href: "/fabric/insights",
      },
      {
        text: `${r.pick(SECTION_LABELS)} has 3 students flagged for low engagement. Review interventions queued.`,
        insight_id: r.id("ins", 2),
      },
      {
        text: `Fee collection: ₹${(87 + r.int(-5, 8)) * 100000}. On track for quarter-end target.`,
      },
      {
        text: `Admissions this week: ${r.int(2, 6)} new students. Capacity utilization at ${75 + r.int(0, 10)}%.`,
        insight_id: r.id("ins", 3),
        href: "/fabric/insights",
      },
      {
        text: `${r.pick(["Math", "Science", "English"])} curriculum coverage: ${78 + r.int(-2, 8)}% of planned units.`,
      }
    );
  } else if (role === "teacher") {
    items.push(
      {
        text: `${r.pick(SECTION_LABELS)} assessment scheduled for ${r.pick(["Tuesday", "Wednesday", "Thursday"])}. ${r.int(28, 35)} students expected.`,
        insight_id: r.id("ins", 4),
      },
      {
        text: `Attendance in your class: ${92 + r.int(-4, 6)}%. ${r.pick(["2 absences", "All present", "1 leave request"])} noted.`,
      },
      {
        text: `Mastery gaps identified in ${r.pick(["algebraic expressions", "photosynthesis", "essay writing"])}. Suggest targeted intervention.`,
        insight_id: r.id("ins", 5),
        href: "/fabric/insights",
      },
      {
        text: `${r.pick(["Quiz results", "Homework submission", "Project submissions"])} reviewed. ${r.int(80, 95)}% on track.`,
      },
      {
        text: `Notifications: ${r.int(2, 4)} parent messages awaiting reply.`,
      },
      {
        text: `Timetable conflict flagged: Check room ${r.int(101, 205)} availability for Friday period ${r.int(1, 6)}.`,
      }
    );
  } else if (role === "guardian") {
    const childName = r.pick(INDIAN_FIRST_NAMES);
    items.push(
      {
        text: `${childName}'s attendance: ${91 + r.int(-3, 6)}% this month. Consistent presence supports learning.`,
      },
      {
        text: `Latest assessment in ${r.pick(SUBJECTS)}: ${r.int(75, 92)}/100. Good progress noted.`,
        insight_id: r.id("ins", 6),
        href: "/fabric/insights",
      },
      {
        text: `Fee status: ${r.pick(["On schedule", "Upcoming reminder", "Payment received"])} for this term.`,
      },
      {
        text: `${childName} is showing strong engagement in ${r.pick(SUBJECTS)}. Encourage continued effort.`,
        insight_id: r.id("ins", 7),
      },
      {
        text: `Next parent-teacher meet: ${r.pick(["Nov 15", "Nov 22", "Dec 1"])}. ${r.int(1, 3)} subjects flagged for discussion.`,
      },
      {
        text: `Behavioral note: ${r.pick(["Positive participation", "Peer collaboration strong", "Attention needs support"])}.`,
      }
    );
  } else {
    // student
    items.push(
      {
        text: `Your attendance: ${90 + r.int(-2, 8)}%. Keep the streak going!`,
      },
      {
        text: `Latest results in ${r.pick(SUBJECTS)}: ${r.int(76, 90)}/100. ${r.pick(["Nice improvement", "On track", "Steady performance"])}.`,
        insight_id: r.id("ins", 8),
      },
      {
        text: `${r.pick(["Quiz", "Assignment", "Project"])} due ${r.pick(["tomorrow", "this Friday", "next week"])}. Check your section notice board.`,
      },
      {
        text: `You're in ${r.pick(SECTION_LABELS)} timetable for next period. Report on time.`,
      },
      {
        text: `Upcoming assessment in ${r.pick(SUBJECTS)}: ${r.pick(["1 week", "2 weeks", "3 weeks"])} from now. Start revision!`,
        insight_id: r.id("ins", 9),
        href: "/fabric/insights",
      }
    );
  }

  return {
    role,
    date,
    headline: roleHeadlines[role],
    items: items.slice(0, r.int(5, 7)),
    generated_by: "fixture",
  };
}

export function priorityActions(opts: FixtureOpts): PriorityAction[] {
  const r = rng((opts.seed ?? 7) + 10);
  const severities: Array<"info" | "watch" | "warning" | "critical"> = [
    "info",
    "watch",
    "warning",
    "critical",
  ];

  const actions: PriorityAction[] = [
    {
      id: r.id("act", 1),
      title: "Review low-attendance patterns",
      why: "3 students show <75% attendance; escalation risk.",
      href: "/fabric/attendance",
      owner: `${r.pick(INDIAN_FIRST_NAMES)} ${r.pick(INDIAN_LAST_NAMES)}`,
      due: isoDate(addDays(opts.now, 2)),
      severity: r.pick(severities),
    },
    {
      id: r.id("act", 2),
      title: "Approve pending fee concessions",
      why: "5 requests queued. 2 days past SLA.",
      href: "/fabric/finance",
      owner: `${r.pick(INDIAN_FIRST_NAMES)} ${r.pick(INDIAN_LAST_NAMES)}`,
      due: isoDate(addDays(opts.now, 1)),
      severity: r.pick(severities),
    },
    {
      id: r.id("act", 3),
      title: "Resolve timetable conflicts",
      why: "Room 203 double-booked Wed period 3. Impact: 2 sections.",
      href: "/fabric/operations",
      owner: `${r.pick(INDIAN_FIRST_NAMES)} ${r.pick(INDIAN_LAST_NAMES)}`,
      due: isoDate(addDays(opts.now, 1)),
      severity: r.pick(severities),
    },
    {
      id: r.id("act", 4),
      title: "Verify data quality for admissions",
      why: "Missing phone numbers in 12 new student records.",
      href: "/fabric/admissions",
      owner: `${r.pick(INDIAN_FIRST_NAMES)} ${r.pick(INDIAN_LAST_NAMES)}`,
      due: isoDate(addDays(opts.now, 3)),
      severity: r.pick(severities),
    },
    {
      id: r.id("act", 5),
      title: "Finalize quarterly budget review",
      why: "Variance alerts in 3 cost categories. Review & approve.",
      href: "/fabric/finance",
      owner: `${r.pick(INDIAN_FIRST_NAMES)} ${r.pick(INDIAN_LAST_NAMES)}`,
      due: isoDate(addDays(opts.now, 4)),
      severity: r.pick(severities),
    },
    {
      id: r.id("act", 6),
      title: "Update curriculum coverage",
      why: "English & Hindi behind schedule by 1 unit each.",
      href: "/fabric/academics",
      owner: `${r.pick(INDIAN_FIRST_NAMES)} ${r.pick(INDIAN_LAST_NAMES)}`,
      due: isoDate(addDays(opts.now, 5)),
      severity: r.pick(severities),
    },
    {
      id: r.id("act", 7),
      title: "Process leave requests",
      why: "6 teacher leave applications pending approval.",
      href: "/fabric/staff",
      owner: `${r.pick(INDIAN_FIRST_NAMES)} ${r.pick(INDIAN_LAST_NAMES)}`,
      due: isoDate(addDays(opts.now, 2)),
      severity: r.pick(severities),
    },
    {
      id: r.id("act", 8),
      title: "Review wellbeing interventions",
      why: "4 students flagged for support; 1 escalation pending.",
      href: "/fabric/insights",
      owner: `${r.pick(INDIAN_FIRST_NAMES)} ${r.pick(INDIAN_LAST_NAMES)}`,
      due: isoDate(addDays(opts.now, 3)),
      severity: r.pick(severities),
    },
  ];

  return actions;
}

export function forecastCards(opts: FixtureOpts): ForecastCard[] {
  const r = rng((opts.seed ?? 7) + 20);

  return [
    {
      metric: "Attendance Rate",
      current: 87,
      forecast: 88,
      unit: "pct",
      confidence: 0.82,
      direction: "up",
    },
    {
      metric: "Fee Collection",
      current: 1850000, // paise = 18,500 rupees
      forecast: 1920000,
      unit: "paise",
      confidence: 0.75,
      direction: "up",
    },
    {
      metric: "New Admissions",
      current: 42,
      forecast: 48,
      unit: "count",
      confidence: 0.68,
      direction: "up",
    },
    {
      metric: "Teacher Load",
      current: 26,
      forecast: 24,
      unit: "count",
      confidence: 0.71,
      direction: r.chance(0.5) ? "down" : "flat",
    },
  ];
}

export function riskIndicators(opts: FixtureOpts): RiskIndicator[] {
  const r = rng((opts.seed ?? 7) + 30);
  const trends: Array<"up" | "flat" | "down"> = ["up", "flat", "down"];

  return [
    {
      id: r.id("risk", 1),
      label: "Low Fee Collection (2 families outstanding >30 days)",
      level: r.pick(["watch", "warning"]),
      trend: r.pick(trends),
      insight_id: r.id("ins", 11),
    },
    {
      id: r.id("risk", 2),
      label: "Curriculum Behind Schedule",
      level: r.pick(["info", "watch"]),
      trend: "down",
      insight_id: r.id("ins", 12),
    },
    {
      id: r.id("risk", 3),
      label: "Teacher Workload Imbalance",
      level: r.pick(["watch", "warning"]),
      trend: r.pick(["up", "flat"]),
      insight_id: null,
    },
    {
      id: r.id("risk", 4),
      label: "Attendance Dips in IX-A Section",
      level: r.pick(["watch", "warning"]),
      trend: "down",
      insight_id: r.id("ins", 13),
    },
    {
      id: r.id("risk", 5),
      label: "Facility Maintenance Backlog",
      level: r.pick(["info", "watch"]),
      trend: "up",
      insight_id: null,
    },
    {
      id: r.id("risk", 6),
      label: "Data Quality: Missing Student Records",
      level: "info",
      trend: "flat",
      insight_id: null,
    },
  ];
}

export function defaultWidgetOrder(
  role: "principal" | "teacher" | "guardian" | "student"
): string[] {
  switch (role) {
    case "principal":
      return [
        "brief",
        "priorities",
        "forecasts",
        "kpis",
        "attendanceTrend",
        "risks",
        "approvals",
        "staff",
        "insights",
      ];
    case "teacher":
      return [
        "brief",
        "priorities",
        "timetable",
        "attendanceTrend",
        "assessments",
        "risks",
        "insights",
      ];
    case "guardian":
      return [
        "brief",
        "kpis",
        "attendanceTrend",
        "insights",
        "approvals",
      ];
    case "student":
      return [
        "brief",
        "kpis",
        "timetable",
        "attendanceTrend",
        "insights",
      ];
  }
}
