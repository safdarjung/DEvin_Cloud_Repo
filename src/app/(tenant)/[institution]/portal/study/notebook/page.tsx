import type { Metadata } from "next";
import { FadeIn } from "@/components/motion";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { getTenantContext } from "@/lib/auth/context";
import { isAiCapabilityEnabled } from "@/modules/ai/capabilities/resolve";
import { requirePermission } from "@/lib/auth/require";
import { NotebookList } from "@/modules/ai/components/NotebookList";
import { listStudyFolders, listStudyItems } from "@/modules/ai/student-study.queries";

export const metadata: Metadata = { title: "Notebook" };

// GU-09 — student-only (ai.study); same reasoning as /portal/study itself
// for why this isn't on the shared guardian/student PortalNav.
export default async function NotebookPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  // Security review (L4) — Next's actual runtime value for a repeated
  // query param (`?search=a&search=b`) is `string[]`, regardless of what
  // a narrower type annotation might claim; the guards below make that
  // case behave as "no filter" instead of throwing inside `.replace()`.
  searchParams: Promise<{ folder?: string | string[]; search?: string | string[] }>;
}) {
  const { institution: institutionSlug } = await params;
  const rawParams = await searchParams;
  const folder = typeof rawParams.folder === "string" ? rawParams.folder : undefined;
  const search = typeof rawParams.search === "string" ? rawParams.search : undefined;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "ai.study");

  const basePath = `/${institutionSlug}/portal/study`;

  if (!isAiCapabilityEnabled(ctx, "study_notebook")) {
    return (
      <PageHeader
        title="My notebook"
        description="The notebook is not included in this school's plan."
        back={{ href: basePath, label: "Back" }}
      />
    );
  }

  const [items, folders] = await Promise.all([listStudyItems(ctx, { folder, search }), listStudyFolders(ctx)]);

  return (
    <div className="space-y-4">
      <PageHeader title="My notebook" back={{ href: basePath, label: "Back to study helper" }} />

      <form action={`${basePath}/notebook`} className="flex flex-wrap gap-2 sm:max-w-sm">
        {folder && <input type="hidden" name="folder" value={folder} />}
        <Input name="search" defaultValue={search} placeholder="Search by title" aria-label="Search by title" />
      </form>

      {folders.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {[null, ...folders].map((f) => {
            const active = f === null ? !folder : folder === f;
            return (
              <Link
                key={f ?? "all"}
                href={f === null ? `${basePath}/notebook` : `${basePath}/notebook?folder=${encodeURIComponent(f)}`}
                aria-current={active ? "true" : undefined}
                className={cn(buttonVariants({ variant: active ? "default" : "outline", size: "sm" }), "min-h-11 sm:min-h-8")}
              >
                {f ?? "All"}
              </Link>
            );
          })}
        </div>
      )}

      <FadeIn>
        <NotebookList institutionSlug={institutionSlug} items={items} />
      </FadeIn>
    </div>
  );
}
