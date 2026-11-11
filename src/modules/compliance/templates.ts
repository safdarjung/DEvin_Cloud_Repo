// Starter list for "Load starter list". Titles and categories only: dates, authorities and
// reference numbers are the school's to fill, so nothing legal is claimed here.
export const COMPLIANCE_CATEGORIES = ["affiliation", "safety", "transport", "staff", "financial", "other"] as const;
export type ComplianceCategory = (typeof COMPLIANCE_CATEGORIES)[number];

export const COMPLIANCE_STARTER: readonly { title: string; category: ComplianceCategory }[] = [
  { title: "Board affiliation", category: "affiliation" },
  { title: "Fire NOC", category: "safety" },
  { title: "Building safety certificate", category: "safety" },
  { title: "Bus fitness certificate", category: "transport" },
  { title: "Bus permit", category: "transport" },
  { title: "Bus insurance", category: "transport" },
  { title: "Driver licence checks", category: "transport" },
  { title: "Staff police verification", category: "staff" },
  { title: "Drinking-water test", category: "safety" },
  { title: "Society or trust audit", category: "financial" },
];
