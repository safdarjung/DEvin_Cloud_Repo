import type { NoticeListBlock } from "@/modules/website/blocks";
import { listPublicNotices } from "@/modules/website/queries";

export async function NoticeList({ block, institutionId }: { block: NoticeListBlock; institutionId: string }) {
  const notices = await listPublicNotices(institutionId, block.limit ?? 5);
  if (notices.length === 0) return null;

  return (
    <section className="py-8">
      <h2 className="mb-4 text-2xl font-semibold">{block.heading ?? "Notices"}</h2>
      <ul className="space-y-3">
        {notices.map((notice) => (
          <li key={notice.id} className="rounded-lg border p-4">
            <div className="font-medium">{notice.title}</div>
            <p className="text-muted-foreground text-sm">{notice.body}</p>
            <div className="text-muted-foreground mt-1 text-xs">{new Date(notice.publishAt).toLocaleDateString()}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
