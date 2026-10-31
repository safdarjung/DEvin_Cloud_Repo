// Fabric operations fixtures: timetable conflicts, teacher workloads, transport routes,
// maintenance requests, and room utilisation. Pure and deterministic.

import type {
  TimetableConflict,
  TeacherWorkload,
  TransportRoute,
  MaintenanceRequest,
  RoomUtilisation,
} from "@/modules/fabric/types";
import { rng, isoDate, addDays, INDIAN_FIRST_NAMES, INDIAN_LAST_NAMES, SECTION_LABELS, SUBJECTS, type FixtureOpts } from "./prng";

export function timetableConflicts(opts: FixtureOpts): TimetableConflict[] {
  const r = rng(opts.seed);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const kinds: TimetableConflict["kind"][] = [
    "teacher_double_booked",
    "room_double_booked",
    "teacher_unavailable",
    "room_capacity",
  ];

  const conflicts: TimetableConflict[] = [];
  for (let i = 0; i < 7; i++) {
    const day = days[i % days.length];
    const period = r.int(1, 8);
    const kind = kinds[i % kinds.length];

    let entities: string[] = [];
    let suggestion = "";

    if (kind === "teacher_double_booked") {
      const teacher = `${r.pick(INDIAN_FIRST_NAMES)} ${r.pick(INDIAN_LAST_NAMES)}`;
      entities = [teacher, `Period ${period}`, `Section ${r.pick(SECTION_LABELS)}`];
      suggestion = `Move ${teacher} to an earlier period.`;
    } else if (kind === "room_double_booked") {
      const room = `Room ${r.int(1, 10)}`;
      entities = [room, `Period ${period}`, `Batch ${r.int(1, 3)}`];
      suggestion = `Shift one class to an adjacent period.`;
    } else if (kind === "teacher_unavailable") {
      const teacher = `${r.pick(INDIAN_FIRST_NAMES)} ${r.pick(INDIAN_LAST_NAMES)}`;
      entities = [teacher, `Period ${period}`, `Leave`];
      suggestion = `Assign a substitute teacher.`;
    } else {
      const room = `Lab-${r.int(1, 3)}`;
      entities = [room, `Period ${period}`, `${r.int(35, 45)} students`];
      suggestion = `Split into two batches or move to larger room.`;
    }

    conflicts.push({
      id: r.id("tblc", i),
      day,
      period,
      kind,
      entities,
      suggestion,
    });
  }

  return conflicts;
}

export function teacherWorkloads(opts: FixtureOpts): TeacherWorkload[] {
  const r = rng(opts.seed);
  const workloads: TeacherWorkload[] = [];

  for (let i = 0; i < 24; i++) {
    const firstName = r.pick(INDIAN_FIRST_NAMES);
    const lastName = r.pick(INDIAN_LAST_NAMES);
    const name = `${firstName} ${lastName}`;

    const periods_week = r.int(20, 30);
    const max_periods = 30;
    const numSubjects = r.int(1, 3);
    const subjects: string[] = [];
    for (let j = 0; j < numSubjects; j++) {
      const subj = r.pick(SUBJECTS);
      if (!subjects.includes(subj)) subjects.push(subj);
    }

    const numSections = r.int(2, 5);
    const sections: string[] = [];
    for (let j = 0; j < numSections; j++) {
      const sec = r.pick(SECTION_LABELS);
      if (!sections.includes(sec)) sections.push(sec);
    }

    const leave_dates: string[] = [];
    if (r.chance(0.3)) {
      const start = addDays(opts.now, r.int(5, 30));
      leave_dates.push(isoDate(start));
      if (r.chance(0.4)) {
        leave_dates.push(isoDate(addDays(start, 1)));
      }
    }

    workloads.push({
      staff_id: r.id("staff", i),
      name,
      periods_week,
      max_periods,
      subjects,
      sections,
      leave_dates,
    });
  }

  return workloads;
}

export function transportRoutes(opts: FixtureOpts): TransportRoute[] {
  const r = rng(opts.seed);
  const routes: TransportRoute[] = [];
  const vehicles = ["Bus A", "Bus B", "Van C", "Mini-Bus D", "Coach E"];
  const drivers = [
    "Ravi Kumar",
    "Sharma",
    "Rao",
    "Singh",
    "Patel",
  ];

  for (let i = 0; i < 5; i++) {
    const stopCount = r.int(5, 8);
    const stops = [];

    for (let j = 0; j < stopCount; j++) {
      stops.push({
        name: `Stop ${String.fromCharCode(65 + j)}`,
        eta: `${8 + Math.floor(j / 2)}:${r.int(0, 1) * 30}${r.int(0, 1) * 30}`,
        students: r.int(5, 15),
        x: r.int(0, 100),
        y: r.int(0, 100),
      });
    }

    const capacity = r.int(40, 60);
    const assigned = r.int(30, capacity);
    const status: TransportRoute["status"] = i === 2 ? "delayed" : i % 2 === 0 ? "on_time" : "off_road";

    routes.push({
      id: r.id("route", i),
      name: `Route ${i + 1}`,
      vehicle: vehicles[i],
      driver: drivers[i],
      stops,
      status,
      capacity,
      assigned,
    });
  }

  return routes;
}

export function maintenanceRequests(opts: FixtureOpts): MaintenanceRequest[] {
  const r = rng(opts.seed);
  const requests: MaintenanceRequest[] = [];
  const priorities: MaintenanceRequest["priority"][] = ["low", "medium", "high"];
  const statuses: MaintenanceRequest["status"][] = ["open", "in_progress", "done"];
  const assets = [
    "Projector-1",
    "Whiteboard-Lab2",
    "HVAC-Wing-A",
    "Door-Frame-201",
    "Light-Fixture-105",
    "Plumbing-Bathroom-3",
    "Desk-Batch-4",
    "Window-Pane-301",
    "Locker-Cabinet-5",
    "Generator-Backup",
  ];
  const locations = [
    "Classroom 101",
    "Science Lab",
    "Library",
    "Computer Room",
    "Auditorium",
    "Admin Office",
    "Storeroom",
    "Corridor-B",
    "Bathroom-West",
    "Basement",
  ];
  const issues = [
    "Bulb replacement",
    "Water leak",
    "Hinge repair",
    "Glass crack",
    "Power failure",
    "Cable loose",
    "Paint touch-up",
    "Lock jam",
    "Fan noise",
    "Electrical inspection",
  ];
  const assignees = [
    "Raj Maintenance",
    "Suresh Repairs",
    "Vikram Services",
    "Ashok Works",
    "Priya Facilities",
  ];

  for (let i = 0; i < 10; i++) {
    const raised_at = isoDate(addDays(opts.now, r.int(-20, 0)));
    const assignee = r.chance(0.7) ? assignees[i % assignees.length] : null;

    requests.push({
      id: r.id("maint", i),
      asset: assets[i],
      location: locations[i],
      issue: issues[i],
      priority: priorities[i % 3],
      status: statuses[i % 3],
      raised_at,
      assignee,
    });
  }

  return requests;
}

export function roomUtilisation(opts: FixtureOpts): RoomUtilisation[] {
  const r = rng(opts.seed);
  const utilisation: RoomUtilisation[] = [];
  const rooms = [
    "Class-101",
    "Class-102",
    "Class-103",
    "Class-201",
    "Class-202",
    "Class-301",
    "Lab-Science",
    "Lab-Computer",
    "Lab-Engineering",
    "Library",
    "Auditorium",
    "Admin",
    "Staff-Room",
    "Cafeteria",
    "Gym",
    "Art-Room",
    "Music-Room",
    "Conference-Hall",
  ];

  for (let i = 0; i < 18; i++) {
    const periods_total = 40;
    const periods_used = r.int(15, 38);
    const capacity = r.int(20, 80);

    utilisation.push({
      room: rooms[i],
      capacity,
      periods_used,
      periods_total,
    });
  }

  return utilisation;
}
