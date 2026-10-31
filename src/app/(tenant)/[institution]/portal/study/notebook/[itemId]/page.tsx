import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { isFeatureEnabled } from "@/lib/auth/entitlements";
import { requirePermission } from "@/lib/auth/require";
import { uuid } from "@/lib/schemas/common";
import { BlockRenderer } from "@/modules/ai/blocks/BlockRenderer";
import { getStudyItem } from "@/modules/ai/student-study.queries";

// GU-09 — a saved "chat" item has no view of its own: it resumes in the
// main study chat (StudyChat's `initialMessages`). Only "note" items get
// a page here, with print CSS for the plan's own "note view with print
// CSS" requirement.
export default async function NotebookItemPage({
  params,
}: {
  params: Promise<{ institution: string; itemId: string }>;
}) {
  const { institution: institutionSlug, itemId } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "ai.study");

  if (!isFeatureEnabled(ctx, "student_ai_notebook")) {
    notFound();
  }

  // Security review (L4) — a non-UUID itemId would otherwise reach
  // Postgres as a malformed uuid literal (22P02) and surface as a 500
  // instead of a plain not-found. RLS (study_items_select, 0049) already
  // scopes a valid id to the caller's own row — a wrong or another
  // student's id reads as not found too, same as any genuinely missing
  // one (no existence oracle either way).
  if (!uuid.safeParse(itemId).success) notFound();
  const item = await getStudyItem(ctx, itemId);
  if (!item) notFound();

  if (item.kind === "chat") {
    redirect(`/${institutionSlug}/portal/study?resume=${item.id}`);
  }

  return (
    <div className="space-y-4">
      <Link href={`/${institutionSlug}/portal/study/notebook`} className="text-muted-foreground text-sm underline print:hidden">
        ← Back to notebook
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{item.title}</h1>
        {item.folder && <p className="text-muted-foreground text-sm">{item.folder}</p>}
        {/* Saved-note honesty label (plan §8) — the note outlives the chat it may have come from. */}
        <p className="text-muted-foreground text-xs italic">AI-assisted note · saved {new Date(item.updatedAt).toLocaleDateString()}</p>
      </div>
      <div className="space-y-3">
        {item.blocks.map((block, index) => (
          <BlockRenderer key={index} block={block} />
        ))}
      </div>
    </div>
  );
}
