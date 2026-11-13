import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { EmptyState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { TEST_STATUS_LABEL, TEST_STATUS_VARIANT, effectiveStatus, fmtDateTime, nowMs } from "@/modules/online-tests/components/test-ui";
import { listTests } from "@/modules/online-tests/queries";
import { TestStatusSchema } from "@/modules/online-tests/schemas";

export const metadata: Metadata = { title: "Online tests" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function OnlineTestsPage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "exams");
  requirePermission(ctx, "online_test.manage");

  const status = TestStatusSchema.safeParse(one(sp.status));
  const tests = await listTests(ctx, { status: status.success ? status.data : undefined });
  const base = `/${slug}/online-tests`;
  const now = nowMs();

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Online tests"
        description="Timed tests set from a published question paper. Objective answers are marked automatically; written answers you mark."
        actions={
          <Button asChild>
            <Link href={`${base}/new`}>
              <Plus className="size-4" aria-hidden /> New test
            </Link>
          </Button>
        }
      />
      <nav aria-label="Filter by status" className="mb-3 flex flex-wrap gap-1.5">
        {[{ v: undefined, l: "All" }, ...TestStatusSchema.options.map((v) => ({ v, l: TEST_STATUS_LABEL[v] }))].map(({ v, l }) => (
          <Button key={l} asChild size="sm" variant={(status.success ? status.data : undefined) === v ? "default" : "outline"}>
            <Link href={v ? `${base}?status=${v}` : base}>{l}</Link>
          </Button>
        ))}
      </nav>
      {tests.length === 0 ? (
        <EmptyState
          title="No tests yet"
          description="Publish a question paper, then set it as an online test for your class."
          action={<Button asChild><Link href={`${base}/new`}>New test</Link></Button>}
        />
      ) : (
        <ul className="space-y-2">
          {tests.map((t) => (
            <li key={t.id}>
              <Link href={`${base}/${t.id}`} data-testid="test-row" className="flex flex-col gap-1 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-medium">{t.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.gradeCode} {t.subjectName} · {fmtDateTime(t.opensAt)} to {fmtDateTime(t.closesAt)} · {t.durationMinutes} min{t.practice ? " · Practice" : ""}
                  </p>
                </div>
                <Badge variant={TEST_STATUS_VARIANT[effectiveStatus(t, now)]}>{TEST_STATUS_LABEL[effectiveStatus(t, now)]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
