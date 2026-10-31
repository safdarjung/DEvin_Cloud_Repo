import type { FixtureOpts } from "./prng";
import { rng, isoDate, addDays } from "./prng";
import type { PersonalMemory, PersonalGoal, WorkspaceSummary } from "../types";

const MEMORY_CONTENT = [
  "Prefers terse answers",
  "Preparing for M.Ed. entrance in 2027",
  "Uses Pomodoro technique for focus",
  "Mentors junior teachers in science pedagogy",
  "Interested in climate-adaptive curriculum design",
  "Avoids scheduling before 8am",
  "Fluent in English, Hindi, and Tamil",
  "Advocates for project-based learning",
  "Building a personal library of educational research",
  "Practices weekly classroom reflection",
  "Collaborates with parents on learning plans",
  "Active member of school science club",
  "Developing lesson plans on sustainable living",
  "Prefers written feedback over meetings",
  "Recently completed online course on assessment strategies",
];

const MEMORY_KINDS: Array<PersonalMemory["kind"]> = [
  "preference",
  "goal",
  "fact",
  "project",
  "context",
];

const GOAL_TITLES = [
  "Complete advanced pedagogy certification",
  "Build curriculum for environmental education",
  "Establish peer learning community",
  "Publish educational research article",
];

const GOAL_TASKS = [
  ["Review course syllabus", "Enroll in modules", "Submit assignments"],
  ["Research existing frameworks", "Develop unit plan", "Test with class", "Revise based on feedback"],
  ["Identify interested colleagues", "Schedule kickoff meeting", "Create shared workspace", "Document learning"],
  ["Select research topic", "Literature review", "Data collection", "Analysis", "Write article"],
];

export function personalMemories(opts: FixtureOpts, userId: string): PersonalMemory[] {
  const r = rng(opts.seed ?? 7);
  const memories: PersonalMemory[] = [];

  for (let i = 0; i < 15; i++) {
    const kind = r.pick(MEMORY_KINDS);
    const isShared = i < 5;
    const hasRetainUntil = r.chance(0.3);

    memories.push({
      id: r.id("mem", i),
      user_id: userId,
      kind,
      content: r.pick(MEMORY_CONTENT),
      source: kind === "context" && r.chance(0.6) ? "inferred" : "user",
      is_shared_with_institution: isShared,
      retain_until: hasRetainUntil
        ? isoDate(addDays(opts.now, 30 + r.int(0, 180)))
        : null,
      created_at: isoDate(addDays(opts.now, -r.int(1, 365))),
      updated_at: isoDate(opts.now),
    });
  }

  return memories;
}

export function personalGoals(opts: FixtureOpts, userId: string): PersonalGoal[] {
  const r = rng(opts.seed ?? 7);
  const goals: PersonalGoal[] = [];

  for (let i = 0; i < 4; i++) {
    const taskCount = 3 + r.int(0, 2);
    const tasks = GOAL_TASKS[i].slice(0, taskCount).map((title, j) => ({
      id: r.id("tsk", i * 5 + j),
      title,
      done: j < Math.ceil(taskCount * 0.4 + r.next() * 0.2),
    }));

    goals.push({
      id: r.id("goal", i),
      user_id: userId,
      title: GOAL_TITLES[i],
      progress_pct: Math.round(
        (tasks.filter((t) => t.done).length / tasks.length) * 100
      ),
      due_date: isoDate(addDays(opts.now, 60 + i * 90)),
      tasks,
      created_at: isoDate(addDays(opts.now, -r.int(10, 100))),
      updated_at: isoDate(opts.now),
    });
  }

  return goals;
}

export function workspaces(opts: FixtureOpts): WorkspaceSummary[] {
  const r = rng(opts.seed ?? 7);

  return [
    {
      id: r.id("ws", 0),
      kind: "personal",
      name: "Personal",
      role: null,
      memory_count: 15,
      is_current: true,
    },
    {
      id: r.id("ws", 1),
      kind: "institution",
      name: "St Joseph's (teacher)",
      role: "educator",
      memory_count: 8,
      is_current: false,
    },
    {
      id: r.id("ws", 2),
      kind: "household",
      name: "Family",
      role: "member",
      memory_count: 3,
      is_current: false,
    },
  ];
}

export interface BoundaryPreviewResult {
  stays: PersonalMemory[];
  revoked: PersonalMemory[];
  note: string;
}

export function boundaryPreview(
  memories: PersonalMemory[]
): BoundaryPreviewResult {
  const stays: PersonalMemory[] = [];
  const revoked: PersonalMemory[] = [];

  for (const mem of memories) {
    // Revoke if institution-sourced "context" with "inferred" source
    if (
      mem.kind === "context" &&
      mem.source === "inferred" &&
      mem.is_shared_with_institution
    ) {
      revoked.push(mem);
    } else if (mem.is_shared_with_institution) {
      // Stays but loses the share flag
      stays.push({
        ...mem,
        is_shared_with_institution: false,
      });
    } else {
      // Everything else stays as-is
      stays.push(mem);
    }
  }

  const note =
    revoked.length > 0
      ? `${revoked.length} inferred context memories were revoked on departure; ${stays.length} personal memories retained.`
      : `All ${stays.length} personal memories retained; none were institution-inferred.`;

  return { stays, revoked, note };
}
