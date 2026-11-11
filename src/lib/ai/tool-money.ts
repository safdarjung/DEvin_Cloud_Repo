// Money a model sees is rupee text from the one formatter (formatINR), never
// a number it must convert. A prompt rule "amounts are in paise: show rupees"
// over tools that return some amounts in paise and others in rupees made
// fee answers 100x too small (finance.collectionReport is rupees).
import { formatINR } from "@/lib/format";

// `*Paise` / `*_paise` fields are converted for every query. These are the
// money fields whose name carries no unit, per registry query.
const RUPEE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "finance.collectionReport": ["billed", "collected", "reversed", "outstanding"],
  "finance.listDefaulters": ["total", "paidTotal", "outstanding"],
  "finance.listInvoices": ["total", "paidTotal"],
  "finance.listInvoicesForStudent": ["total", "paidTotal"],
  "feePlans.lateFeeRules": ["amount", "cap"],
  "feePlans.instalments": ["total", "paidTotal", "amount", "paidAmount"],
  "library.myLoans": ["fine"],
};
const PAISE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "library.overdue": ["fineSoFar"],
};
// Objects that carry their own unit: forecast cards ({ unit: "paise", current,
// forecast }) and insight evidence ({ unit: "₹", value }).
const TAGGED_PAISE = ["current", "forecast", "point", "lower", "upper", "value"];
const TAGGED_RUPEES = ["value"];

const PAISE_SUFFIX = /_?[Pp]aise$/;
const NONE: readonly string[] = [];

function convert(value: unknown, rupees: readonly string[], paise: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => convert(item, rupees, paise));
  if (value === null || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const tag = obj.unit === "paise" || obj.unit === "₹" ? obj.unit : null;
  const ownPaise = tag === "paise" ? TAGGED_PAISE : paise;
  const ownRupees = tag === "₹" ? TAGGED_RUPEES : rupees;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(obj)) {
    if (tag && key === "unit") continue;
    const base = key.replace(PAISE_SUFFIX, "");
    if (base !== key && base && (typeof v === "number" || v === null)) {
      // Keep the original name only if the bare one is already taken.
      out[base in obj ? key : base] = v === null ? null : formatINR(v);
    } else if (typeof v === "number" && ownPaise.includes(key)) {
      out[key] = formatINR(v);
    } else if (typeof v === "number" && ownRupees.includes(key)) {
      out[key] = formatINR(Math.round(v * 100));
    } else {
      out[key] = convert(v, rupees, paise);
    }
  }
  return out;
}

/** A registry query's result with every money value as rupee text ("₹2,96,35,350"); counts stay numbers. */
export function moneyForModel(query: string, data: unknown): unknown {
  return convert(data, RUPEE_FIELDS[query] ?? NONE, PAISE_FIELDS[query] ?? NONE);
}
