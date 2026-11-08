import { BlockRenderer } from "@/modules/website/components/blocks/BlockRenderer";
import { parseBlocksSafely, type Block } from "@/modules/website/blocks";

interface DraftPreviewProps {
  blocks: Block[];
  slug: string;
  institutionId: string;
}

/**
 * Renders a draft's blocks with the exact same per-type components the
 * public site uses (packet: reuse the renderer, don't fork it) — but only
 * ever from inside the authenticated tenant route (this file is never
 * imported by `src/app/s/**`). `parseBlocksSafely` re-filters the blocks
 * even though they already came from `BlockEditor`'s local state, in case
 * that state is mid-edit and momentarily invalid — the preview must never
 * throw (same rule as the public renderer).
 */
export function DraftPreview({ blocks, slug, institutionId }: DraftPreviewProps) {
  const safeBlocks = parseBlocksSafely(blocks);
  return (
    <div className="min-w-0 rounded-lg border bg-card">
      <div className="text-muted-foreground border-b bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wide">
        Draft preview
      </div>
      <div className="px-4">
        <BlockRenderer blocks={safeBlocks} slug={slug} institutionId={institutionId} />
      </div>
    </div>
  );
}
