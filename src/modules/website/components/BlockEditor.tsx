"use client";

// T-025 — the block editor (06 §W3, packet "one form per block type driven
// by the Zod union"). All edits are local state; nothing reaches the
// server until "Save as new version" is pressed, which calls
// `savePageVersion` (never mutates `page_versions.blocks` — that action
// only ever inserts v+1). Reordering is up/down buttons only (packet:
// no drag-and-drop, no new dependency).
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActionResult } from "@/lib/actions/result";
import { BlockSchema, type Block } from "@/modules/website/blocks";
import { savePageVersion } from "@/modules/website/actions";

const BLOCK_TYPES = [
  { value: "hero", label: "Hero" },
  { value: "rich_text", label: "Rich text" },
  { value: "image", label: "Image" },
  { value: "stats", label: "Stats" },
  { value: "notice_list", label: "Notice list" },
  { value: "event_list", label: "Event list" },
  { value: "enquiry_form", label: "Enquiry form" },
  { value: "contact", label: "Contact" },
] as const;

type BlockType = (typeof BLOCK_TYPES)[number]["value"];

function defaultBlockFor(type: BlockType): Block {
  switch (type) {
    case "hero":
      return { type: "hero", heading: "" };
    case "rich_text":
      return { type: "rich_text", nodes: [{ type: "paragraph", spans: [{ text: "" }] }] };
    case "image":
      return { type: "image", url: "", alt: "" };
    case "stats":
      return { type: "stats", items: [{ label: "", value: "" }] };
    case "notice_list":
      return { type: "notice_list" };
    case "event_list":
      return { type: "event_list" };
    case "enquiry_form":
      return { type: "enquiry_form" };
    case "contact":
      return { type: "contact" };
  }
}

/** First BlockSchema issue for this block, or `null` when it's already valid — drives the inline error and blocks Save (acceptance criterion 4: invalid block, no version created). */
function firstBlockError(block: Block): string | null {
  const parsed = BlockSchema.safeParse(block);
  if (parsed.success) return null;
  return parsed.error.issues[0]?.message ?? "Invalid block.";
}

/** Flattens a rich_text block's nodes into editable plain text — a readable but lossy view (shortcut below). */
function richTextToDraft(block: Extract<Block, { type: "rich_text" }>): string {
  return block.nodes
    .map((node) => {
      if (node.type === "heading") return node.text;
      if (node.type === "list") return node.items.join("\n");
      return node.spans.map((s) => s.text).join("");
    })
    .join("\n\n");
}

// shortcut: editing a rich_text block's textarea always rewrites it as
// plain paragraphs — heading/list node types are not reconstructable from
// this plain-text view. A block the user never touches keeps its original
// nodes untouched (see RichTextFields below). Upgrade to a structured
// node-by-node editor if the demo needs headings/lists to be editable.
function draftToRichText(draft: string): Extract<Block, { type: "rich_text" }> {
  const paragraphs = draft.split(/\n\s*\n/).map((text) => ({ type: "paragraph" as const, spans: [{ text }] }));
  return { type: "rich_text", nodes: paragraphs.length > 0 ? paragraphs : [{ type: "paragraph", spans: [{ text: "" }] }] };
}

interface FieldProps<T extends Block> {
  block: T;
  onChange: (next: T) => void;
}

function HeroFields({ block, onChange }: FieldProps<Extract<Block, { type: "hero" }>>) {
  return (
    <div className="space-y-2">
      <Input
        placeholder="Heading"
        value={block.heading}
        onChange={(e) => onChange({ ...block, heading: e.target.value })}
      />
      <Input
        placeholder="Subheading (optional)"
        value={block.subheading ?? ""}
        onChange={(e) => onChange({ ...block, subheading: e.target.value || undefined })}
      />
      <Input
        placeholder="Image URL (optional)"
        value={block.imageUrl ?? ""}
        onChange={(e) => onChange({ ...block, imageUrl: e.target.value || undefined })}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          placeholder="Button label (optional)"
          value={block.cta?.label ?? ""}
          onChange={(e) => {
            const label = e.target.value;
            onChange({ ...block, cta: label ? { label, href: block.cta?.href ?? "" } : undefined });
          }}
        />
        <Input
          placeholder="Button link"
          value={block.cta?.href ?? ""}
          onChange={(e) => {
            const href = e.target.value;
            onChange({ ...block, cta: block.cta ? { ...block.cta, href } : href ? { label: "", href } : undefined });
          }}
        />
      </div>
    </div>
  );
}

function RichTextFields({ block, onChange }: FieldProps<Extract<Block, { type: "rich_text" }>>) {
  const [draft, setDraft] = useState(() => richTextToDraft(block));
  return (
    <Textarea
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(draftToRichText(e.target.value));
      }}
      placeholder="Paragraph text. Leave a blank line between paragraphs."
      className="min-h-28"
    />
  );
}

function ImageFields({ block, onChange }: FieldProps<Extract<Block, { type: "image" }>>) {
  return (
    <div className="space-y-2">
      <Input placeholder="Image URL" value={block.url} onChange={(e) => onChange({ ...block, url: e.target.value })} />
      <Input placeholder="Alt text" value={block.alt} onChange={(e) => onChange({ ...block, alt: e.target.value })} />
      <Input
        placeholder="Caption (optional)"
        value={block.caption ?? ""}
        onChange={(e) => onChange({ ...block, caption: e.target.value || undefined })}
      />
    </div>
  );
}

function StatsFields({ block, onChange }: FieldProps<Extract<Block, { type: "stats" }>>) {
  return (
    <div className="space-y-2">
      <Input
        placeholder="Heading (optional)"
        value={block.heading ?? ""}
        onChange={(e) => onChange({ ...block, heading: e.target.value || undefined })}
      />
      {block.items.map((item, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <Input
            placeholder="Label"
            value={item.label}
            onChange={(e) => {
              const items = block.items.map((it, idx) => (idx === i ? { ...it, label: e.target.value } : it));
              onChange({ ...block, items });
            }}
          />
          <Input
            placeholder="Value"
            value={item.value}
            onChange={(e) => {
              const items = block.items.map((it, idx) => (idx === i ? { ...it, value: e.target.value } : it));
              onChange({ ...block, items });
            }}
          />
          {block.items.length > 1 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange({ ...block, items: block.items.filter((_, idx) => idx !== i) })}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      {block.items.length < 8 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange({ ...block, items: [...block.items, { label: "", value: "" }] })}
        >
          Add stat
        </Button>
      )}
    </div>
  );
}

function ListBlockFields({
  block,
  onChange,
}: FieldProps<Extract<Block, { type: "notice_list" | "event_list" | "enquiry_form" }>>) {
  return (
    <div className="space-y-2">
      <Input
        placeholder="Heading (optional)"
        value={block.heading ?? ""}
        onChange={(e) => onChange({ ...block, heading: e.target.value || undefined } as typeof block)}
      />
      {block.type !== "enquiry_form" && (
        <Input
          type="number"
          min={1}
          max={20}
          placeholder="How many to show (optional)"
          value={block.limit ?? ""}
          onChange={(e) =>
            onChange({ ...block, limit: e.target.value ? Number(e.target.value) : undefined } as typeof block)
          }
        />
      )}
      {block.type === "enquiry_form" && (
        <Input
          placeholder="Button label (optional)"
          value={block.ctaLabel ?? ""}
          onChange={(e) => onChange({ ...block, ctaLabel: e.target.value || undefined } as typeof block)}
        />
      )}
    </div>
  );
}

function ContactFields({ block, onChange }: FieldProps<Extract<Block, { type: "contact" }>>) {
  return (
    <div className="space-y-2">
      <Input
        placeholder="Heading (optional)"
        value={block.heading ?? ""}
        onChange={(e) => onChange({ ...block, heading: e.target.value || undefined })}
      />
      <Input
        placeholder="Address (optional)"
        value={block.address ?? ""}
        onChange={(e) => onChange({ ...block, address: e.target.value || undefined })}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          placeholder="Phone (optional)"
          value={block.phone ?? ""}
          onChange={(e) => onChange({ ...block, phone: e.target.value || undefined })}
        />
        <Input
          placeholder="Email (optional)"
          value={block.email ?? ""}
          onChange={(e) => onChange({ ...block, email: e.target.value || undefined })}
        />
      </div>
      <Input
        placeholder="Map link (optional)"
        value={block.mapUrl ?? ""}
        onChange={(e) => onChange({ ...block, mapUrl: e.target.value || undefined })}
      />
    </div>
  );
}

function BlockFields({ block, onChange }: FieldProps<Block>) {
  switch (block.type) {
    case "hero":
      return <HeroFields block={block} onChange={onChange} />;
    case "rich_text":
      return <RichTextFields block={block} onChange={onChange} />;
    case "image":
      return <ImageFields block={block} onChange={onChange} />;
    case "stats":
      return <StatsFields block={block} onChange={onChange} />;
    case "notice_list":
    case "event_list":
    case "enquiry_form":
      return <ListBlockFields block={block} onChange={onChange} />;
    case "contact":
      return <ContactFields block={block} onChange={onChange} />;
  }
}

interface BlockEditorProps {
  institutionSlug: string;
  pageId: string;
  initialBlocks: Block[];
}

export function BlockEditor({ institutionSlug, pageId, initialBlocks }: BlockEditorProps) {
  const router = useRouter();
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [newType, setNewType] = useState<BlockType>("hero");

  const errors = blocks.map(firstBlockError);
  const hasErrors = errors.some((e) => e !== null);

  function updateBlock(index: number, next: Block) {
    setBlocks((bs) => bs.map((b, i) => (i === index ? next : b)));
  }

  function removeBlock(index: number) {
    setBlocks((bs) => bs.filter((_, i) => i !== index));
  }

  function moveBlock(index: number, direction: -1 | 1) {
    setBlocks((bs) => {
      const target = index + direction;
      if (target < 0 || target >= bs.length) return bs;
      const next = [...bs];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  const [state, formAction, pending] = useActionState<ActionResult<{ id: string; versionNo: number }> | null, FormData>(
    async () => {
      if (hasErrors) {
        return {
          ok: false,
          error: { code: "validation_failed", message: "Fix the highlighted blocks before saving." },
        };
      }
      return savePageVersion(institutionSlug, { pageId, blocks });
    },
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <div className="space-y-4">
      {blocks.map((block, index) => (
        <div key={index} className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge variant="secondary" className="capitalize">
              {block.type.replace("_", " ")}
            </Badge>
            <div className="flex gap-1">
              <Button type="button" variant="outline" size="sm" onClick={() => moveBlock(index, -1)} disabled={index === 0}>
                Up
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => moveBlock(index, 1)}
                disabled={index === blocks.length - 1}
              >
                Down
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => removeBlock(index)}>
                Remove
              </Button>
            </div>
          </div>
          <BlockFields block={block} onChange={(next) => updateBlock(index, next)} />
          {errors[index] && (
            <p role="alert" className="text-sm text-destructive">
              {errors[index]}
            </p>
          )}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={newType} onValueChange={(v) => setNewType(v as BlockType)}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BLOCK_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" onClick={() => setBlocks((bs) => [...bs, defaultBlockFor(newType)])}>
          Add block
        </Button>
      </div>

      <form action={formAction} className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button type="submit" disabled={pending || hasErrors}>
          {pending ? "Saving…" : "Save as new version"}
        </Button>
        {state && !state.ok && (
          <span role="alert" className="text-destructive text-sm">
            {state.error.message}
          </span>
        )}
        {state?.ok && (
          <span role="status" className="text-sm text-muted-foreground">
            Saved as version {state.data.versionNo}.
          </span>
        )}
      </form>
    </div>
  );
}
