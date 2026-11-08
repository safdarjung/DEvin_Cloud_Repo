import { notFound } from "next/navigation";
import { LimitedBadge } from "@/components/honesty";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FadeIn } from "@/components/motion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Section {
  title: string;
  description: string;
  columns: string[];
  action: string;
  missing: string[];
}

const SECTIONS: Record<string, Section> = {
  institutions: {
    title: "Institutions",
    description: "Every school on the platform.",
    columns: ["Name", "Type", "Contact", "Registered", "Plan", "Status", "Students", "Staff", "Renewal", "Onboarding"],
    action: "Add institution",
    missing: [
      "Cross-tenant institutions list: RLS (institutions_select) is members-only, so it needs a platform-admin read API",
      "Plan, status and renewal: no plans or subscriptions tables",
      "Student and staff counts: platform-level aggregates over every tenant",
      "Onboarding progress: no onboarding state stored",
    ],
  },
  subscriptions: {
    title: "Subscriptions",
    description: "Plans and subscription state per institution.",
    columns: ["Institution", "Plan", "Status", "Seats", "Started", "Renews", "MRR"],
    action: "New plan",
    missing: ["Plans and subscriptions tables (none exist)", "Platform-admin read API to join them to institutions"],
  },
  billing: {
    title: "Billing",
    description: "Invoices raised to schools by the platform.",
    columns: ["Invoice", "Institution", "Period", "Amount", "Status", "Due", "Paid on"],
    action: "Create invoice",
    missing: [
      "School-facing invoices and payments tables (the existing finance tables are a school's fees from parents, not platform billing)",
      "Payment gateway or manual-collection workflow for platform subscriptions",
    ],
  },
  usage: {
    title: "Usage",
    description: "Activity and AI usage across institutions.",
    columns: ["Institution", "Active users", "Students", "AI requests", "Storage", "Last active"],
    action: "Export usage",
    missing: [
      "Cross-tenant aggregates of ai_usage and activity (audit_events), readable only by a platform admin",
      "Storage metering per institution",
    ],
  },
  settings: {
    title: "Settings",
    description: "Platform-wide configuration.",
    columns: ["Setting", "Value", "Updated", "Updated by"],
    action: "Add platform admin",
    missing: [
      "Platform settings store (none exists)",
      "Audited action to grant or revoke is_platform_admin (users cannot self-set it; today it is set directly in the database)",
    ],
  },
};

export default async function PlatformSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const s = Object.hasOwn(SECTIONS, section) ? SECTIONS[section] : undefined;
  if (!s) notFound();

  return (
    <>
      <PageHeader
        title={s.title}
        description={s.description}
        actions={
          <span title="Not available yet">
            <Button type="button" disabled aria-disabled="true">
              {s.action}
            </Button>
          </span>
        }
      />
      <FadeIn>
        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2" title="Not available yet">
              <Input disabled aria-disabled="true" aria-label={`Search ${s.title.toLowerCase()}`} placeholder="Search" className="max-w-xs" />
              <Button type="button" variant="outline" disabled aria-disabled="true">
                Filter
              </Button>
              <LimitedBadge />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  {s.columns.map((c) => (
                    <TableHead key={c}>{c}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={s.columns.length} className="py-10 text-center text-muted-foreground">
                    No data. This view needs the platform backend described below.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </FadeIn>
      <FadeIn delay={0.06}>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Missing backend</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {s.missing.map((m, i) => (
                <FadeIn as="li" key={m} delay={0.06 + i * 0.025}>
                  {m}
                </FadeIn>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">Tracked as F-IDN-13, Platform superadmin console (P3).</p>
          </CardContent>
        </Card>
      </FadeIn>
    </>
  );
}
