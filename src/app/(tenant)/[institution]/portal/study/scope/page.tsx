import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { uuid } from "@/lib/schemas/common";
import { roleAiConfig } from "@/modules/ai/capabilities/resolve";
import { ScopePicker } from "@/modules/study/components/ScopePicker";
import { hasFileConsent } from "@/modules/study/help.queries";
import { chapterSummary } from "@/modules/study/scope";
import { scopeOptions, scopeSessions } from "@/modules/study/scope.queries";

export const metadata: Metadata = { title: "Study with AI" };

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

// 0140 item 8 — student only (ai.study + the role's chat switch): choose
// books, chapters, units or files of your own grade, then study them with the
// AI tutor. Saved sessions resume from here.
export default async function StudyScopePage({ params, searchParams }: { params: Promise<{ institution: string }>; searchParams: Promise<{ subject?: string }> }) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requirePermission(ctx, "ai.study");
  if (!isModuleEnabled(ctx, "ai_student")) notFound();
  if (!ctx.membership.studentId) redirect(`/${slug}/portal`);
  const chatOn = roleAiConfig(ctx, ctx.membership.role).enabled;

  const [options, sessions, consent] = await Promise.all([scopeOptions(ctx), scopeSessions(ctx), hasFileConsent(ctx)]);
  const { allowed, progress } = options;
  return (
    <>
      <PageHeader
        title="Study with AI"
        description="Choose books, chapters or topics from your own class and study them with an AI tutor. It works from your school's chapter and unit outlines; it has not read NCERT books."
        back={{ href: `/${slug}/portal/study/studio`, label: "Study studio" }}
        compact
      />
      {sessions.length > 0 && (
        <section aria-labelledby="sessions-h" className="mb-6 space-y-2">
          <h2 id="sessions-h" className="text-base font-semibold">Your study sessions</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link href={`/${slug}/portal/study/scope/${s.id}`} className="block min-h-14 rounded-xl border bg-card p-3 text-sm hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="block truncate font-medium">{s.title}</span>
                  <span className="text-xs text-muted-foreground">Last used {dateFmt.format(new Date(s.updatedAt))} · resume</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!chatOn ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">Your school has switched the AI tutor off for students.</p>
      ) : allowed.subjects.length === 0 ? (
        <p className="text-sm text-muted-foreground">You are not in a class with subjects yet.</p>
      ) : (
        <ScopePicker
          institutionSlug={slug}
          subjects={allowed.subjects}
          books={allowed.books.map((b) => ({ ...b, summary: chapterSummary(b, allowed.units, progress) }))}
          units={allowed.units.map((u) => ({ id: u.id, subjectId: u.subjectId, title: u.title, chapter: u.chapter, minutes: progress[u.id]?.minutes ?? 0, accuracy: progress[u.id]?.accuracy ?? null }))}
          files={allowed.files}
          consent={consent}
          initialSubjectId={sp.subject && uuid.safeParse(sp.subject).success ? sp.subject : undefined}
        />
      )}
    </>
  );
}
