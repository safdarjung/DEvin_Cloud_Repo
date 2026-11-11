// Lab safety check: deterministic, no model. Pure so it is unit-testable and the AI layer can word it later.
// Relative imports only (no @/): importable from seed scripts.

export const LOW_QUANTITY_THRESHOLD = 5; // shortcut: one number for every unit (ml, g, pcs); make it per-item when schools ask.

export interface SafetyEquipment {
  id: string;
  name: string;
  kind: string;
  quantity: number;
  unit: string;
  hazardClass: string | null;
  expiryOn: string | null;
}

export type SafetyReason = "expired" | "hazard" | "out_of_stock";

export interface SafetyWarning {
  equipmentId: string;
  name: string;
  reasons: SafetyReason[];
  /** Plain-English line, e.g. "Sulphuric acid: expired 3 days ago; hazard class corrosive." */
  text: string;
}

const DAY_MS = 86_400_000;

/** Whole days from `today` to `date` (both YYYY-MM-DD). Negative when `date` is past. */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(date) - Date.parse(today)) / DAY_MS);
}

/** "Expired" / "Expires today" / "Expires in N days"; "" when there is no expiry. */
export function expiryText(expiryOn: string | null, today: string): string {
  if (!expiryOn) return "";
  const d = daysUntil(expiryOn, today);
  if (d < 0) return "Expired";
  if (d === 0) return "Expires today";
  return `Expires in ${d} ${d === 1 ? "day" : "days"}`;
}

const humanHazard = (h: string) => h.replace(/_/g, " ");

/** Items of ONE lab's register that are expired, hazard-classed, or at zero quantity. */
export function labSafetyWarnings(equipment: SafetyEquipment[], today: string): SafetyWarning[] {
  const out: SafetyWarning[] = [];
  for (const e of equipment) {
    const reasons: SafetyReason[] = [];
    const parts: string[] = [];
    if (e.expiryOn && daysUntil(e.expiryOn, today) < 0) {
      const ago = -daysUntil(e.expiryOn, today);
      reasons.push("expired");
      parts.push(`expired ${ago} ${ago === 1 ? "day" : "days"} ago`);
    }
    if (e.hazardClass) {
      reasons.push("hazard");
      parts.push(`hazard class ${humanHazard(e.hazardClass)}`);
    }
    if (e.quantity <= 0) {
      reasons.push("out_of_stock");
      parts.push("none left");
    }
    if (reasons.length > 0) out.push({ equipmentId: e.id, name: e.name, reasons, text: `${e.name}: ${parts.join("; ")}.` });
  }
  return out;
}
