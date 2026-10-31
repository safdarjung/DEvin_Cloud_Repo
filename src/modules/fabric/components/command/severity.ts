import { AlertOctagon, AlertTriangle, Eye, Info, type LucideIcon } from "lucide-react";
import type { InsightSeverity } from "@/modules/fabric/types";

// Severity is icon + text + colour, never colour alone.
export const SEVERITY: Record<InsightSeverity, { label: string; icon: LucideIcon; text: string; chip: string }> = {
  info: { label: "Info", icon: Info, text: "text-info", chip: "bg-info/10 text-info" },
  watch: { label: "Watch", icon: Eye, text: "text-warning", chip: "bg-warning/10 text-warning" },
  warning: { label: "Warning", icon: AlertTriangle, text: "text-warning", chip: "bg-warning/15 text-warning" },
  critical: { label: "Critical", icon: AlertOctagon, text: "text-destructive", chip: "bg-destructive/10 text-destructive" },
};

// The priority fixtures link to workspaces that don't exist as routes; send them to the nearest real page.
const HREF_FALLBACK: Record<string, string> = {
  "/fabric/attendance": "/attendance",
  "/fabric/admissions": "/admissions",
  "/fabric/finance": "/finance",
  "/fabric/academics": "/fabric/learning",
  "/fabric/staff": "/fabric/operations",
};

export const resolveHref = (base: string, href: string): string => `${base}${HREF_FALLBACK[href] ?? href}`;
