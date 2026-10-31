import Link from "next/link";
import { Input } from "@/components/ui/input";
import { getTenantContext } from "@/lib/auth/context";
import { isFeatureEnabled } from "@/lib/auth/entitlements";
import { requirePermission } from "@/lib/auth/require";
import { NotebookList } from "@/modules/ai/components/NotebookList";
import { listStudyFolders, listStudyItems } from "@/modules/ai/student-study.queries";

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

  if (!isFeatureEnabled(ctx, "student_ai_notebook")) {
    return (
      <div className="space-y-2">
        <Link href={basePath} className="text-muted-foreground text-sm underline">
          ← Back
        </Link>
        <h1 className="text-xl font-semibold">My notebook</h1>
        <p className="text-muted-foreground text-sm">The notebook is not included in this school&apos;s plan.</p>
      </div>
    );
  }

  const [items, folders] = await Promise.all([listStudyItems(ctx, { folder, search }), listStudyFolders(ctx)]);

  return (
    <div className="space-y-4">
      <Link href={basePath} className="text-muted-foreground text-sm underline">
        ← Back to study helper
      </Link>
      <h1 className="text-xl font-semibold">My notebook</h1>

      <form action={`${basePath}/notebook`} className="flex gap-2">
        {folder && <input type="hidden" name="folder" value={folder} />}
        <Input name="search" defaultValue={search} placeholder="Search by title" />
      </form>

      {folders.length > 0 && (
        <div className="flex flex-wrap gap-1 text-sm">
          <Link href={`${basePath}/notebook`} className={!folder ? "font-semibold underline" : "text-muted-foreground underline"}>
            All
          </Link>
          {folders.map((f) => (
            <Link
              key={f}
              href={`${basePath}/notebook?folder=${encodeURIComponent(f)}`}
              className={folder === f ? "font-semibold underline" : "text-muted-foreground underline"}
            >
              {f}
            </Link>
          ))}
        </div>
      )}

      <NotebookList institutionSlug={institutionSlug} items={items} />
    </div>
  );
}
