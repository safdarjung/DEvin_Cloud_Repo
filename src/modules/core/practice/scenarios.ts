import type { Permission } from "@/lib/auth/permissions";
import type { ModuleKey } from "@/lib/modules/catalog";

// Practice scenarios: one click makes a small, realistic set of records for one tab, so a person
// trying the demo school can test that feature with a situation they choose. Each one writes
// through the owning module's own action (same validation, permission and audit as a person
// typing it in). Demo school only: the demo is reset, a real school's records are not.

export interface PracticeScenario {
  /** Institution-relative sidebar hrefs the scenario shows on (staff and portal tabs differ). */
  tabs: readonly string[];
  label: string;
  /** What gets created, in one sentence, shown under the button. */
  detail: string;
  permission: Permission;
  module: ModuleKey;
}

export const PRACTICE_SCENARIOS = {
  "helpdesk.urgent": {
    tabs: ["/helpdesk", "/portal/helpdesk"],
    label: "An urgent bus complaint",
    detail: "One urgent transport ticket to the office, to follow its response target.",
    permission: "helpdesk.raise",
    module: "helpdesk",
  },
  "helpdesk.mixed": {
    tabs: ["/helpdesk"],
    label: "A busy morning: 3 tickets",
    detail: "A fee query, a broken projector and a portal login problem, at different priorities.",
    permission: "helpdesk.raise",
    module: "helpdesk",
  },
  "visitors.rush": {
    tabs: ["/visitors"],
    label: "Gate rush: 3 visitors",
    detail: "A parent, a vendor and a guest speaker checked in now, to test check-out.",
    permission: "visitor.manage",
    module: "visitors",
  },
  "behaviour.mixed": {
    tabs: ["/behaviour"],
    label: "A merit and a demerit",
    detail: "One merit and one demerit today, for two different students.",
    permission: "behaviour.write",
    module: "behaviour",
  },
  "behaviour.repeat": {
    tabs: ["/behaviour"],
    label: "A repeat offender",
    detail: "Three demerits this week for the same student, to test patterns and follow-up.",
    permission: "behaviour.write",
    module: "behaviour",
  },
  "finance.part-payment": {
    tabs: ["/finance"],
    label: "A family pays half",
    detail: "Half of one unpaid invoice paid by UPI now, so you can open the receipt and the balance.",
    permission: "finance.payment.record",
    module: "fees",
  },
  "health.sent-home": {
    tabs: ["/health"],
    label: "A student sent home",
    detail: "An infirmary visit with fever where the student is sent home.",
    permission: "health.write",
    module: "health",
  },
  "health.minor": {
    tabs: ["/health"],
    label: "Two minor visits",
    detail: "A scraped knee and a headache, both back to class.",
    permission: "health.write",
    module: "health",
  },
} as const satisfies Record<string, PracticeScenario>;

export type PracticeScenarioKey = keyof typeof PRACTICE_SCENARIOS;
export const PRACTICE_SCENARIO_KEYS = Object.keys(PRACTICE_SCENARIOS) as [PracticeScenarioKey, ...PracticeScenarioKey[]];

export interface PracticeOption {
  key: PracticeScenarioKey;
  label: string;
  detail: string;
}

/** Scenarios for one tab that this member may run: demo school only, module on, permission held. */
export function practiceOptionsFor(
  tab: string,
  can: { isDemo: boolean; has: (p: Permission) => boolean; moduleOn: (m: ModuleKey) => boolean },
): PracticeOption[] {
  if (!can.isDemo) return [];
  return PRACTICE_SCENARIO_KEYS.filter((key) => {
    const s = PRACTICE_SCENARIOS[key];
    return (s.tabs as readonly string[]).includes(tab) && can.has(s.permission) && can.moduleOn(s.module);
  }).map((key) => ({ key, label: PRACTICE_SCENARIOS[key].label, detail: PRACTICE_SCENARIOS[key].detail }));
}
