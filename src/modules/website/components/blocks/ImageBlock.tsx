import type { ImageBlock as ImageBlockType } from "@/modules/website/blocks";

export function ImageBlock({ block }: { block: ImageBlockType }) {
  return (
    <figure className="py-6">
      {/* eslint-disable-next-line @next/next/no-img-element -- editor-authored URL, not a build-time static asset */}
      <img src={block.url} alt={block.alt} className="mx-auto max-h-[32rem] w-full rounded-xl border object-cover" />
      {block.caption && <figcaption className="mt-2 text-center text-sm text-muted-foreground">{block.caption}</figcaption>}
    </figure>
  );
}
