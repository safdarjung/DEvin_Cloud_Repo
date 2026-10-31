import type { NoticeListBlock } from "@/modules/website/blocks";
import { listPublicNotices } from "@/modules/website/queries";

export async function NoticeList({ block, institutionId }: { block: NoticeListBlock; institutionId: string }) {
  const notices = await listPublicNotices(institutionId, block.limit ?? 5);
  if (notices.length === 0) return null;

  return (
    <section className="py-8">
      <h2 className="mb-4 text-2xl font-semibold tracking-tight">{block.heading ?? "Notices"}</h2>
      <ul className="divide-y rounded-xl border bg-card">
        {notices.map((notice) => (
          <li key={notice.id} className="space-y-1 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <h3 className="font-medium">{notice.title}</h3>
              <time className="text-xs text-muted-foreground" dateTime={String(notice.publishAt)}>
                {new Date(notice.publishAt).toLocaleDateString()}
              </time>
            </div>
            <p className="text-sm text-muted-foreground">{notice.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
