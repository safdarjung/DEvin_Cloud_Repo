import type { NotesBlock } from "@/modules/ai/blocks/schemas";

/** Read-only. Every field is plain text — no markdown, no `dangerouslySetInnerHTML` (D31). */
export function NotesBlockView({ block }: { block: NotesBlock }) {
  return (
    <div className="space-y-3">
      {block.sections.map((section, index) => (
        <div key={index} className="rounded-lg border border-border p-3">
          {/* Review finding (MEDIUM): not wired into a page yet, so this
              can't be sized against a real heading hierarchy — emphasis
              text, not a heading level, until a caller confirms one. */}
          <p className="font-medium">{section.heading}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {section.bullets.map((bullet, bulletIndex) => (
              <li key={bulletIndex}>{bullet}</li>
            ))}
          </ul>
          {section.example && <p className="text-muted-foreground mt-2 text-sm italic">{section.example}</p>}
        </div>
      ))}
    </div>
  );
}
