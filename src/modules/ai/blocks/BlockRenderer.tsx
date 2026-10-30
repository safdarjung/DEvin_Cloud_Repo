// Review finding (MEDIUM): no "use client" here — this is a plain
// switch with no hooks/state, so it stays Server-Component-safe. Only
// FlashcardsBlockView, PracticeBlockView, ChartBlockView and
// MindmapBlockView need the client boundary, and each already declares
// its own.
//
// D31 — single dispatch point for the generative-UI block catalog
// (schemas.ts). One block in, one rendered component out; a caller maps
// over an array of blocks the same way TeacherAgentChat.tsx already maps
// over message parts.
import type { Block } from "@/modules/ai/blocks/schemas";
import { CalloutBlockView } from "@/modules/ai/blocks/components/CalloutBlockView";
import { ChartBlockView } from "@/modules/ai/blocks/components/ChartBlockView";
import { FlashcardsBlockView } from "@/modules/ai/blocks/components/FlashcardsBlockView";
import { MindmapBlockView } from "@/modules/ai/blocks/components/MindmapBlockView";
import { NotesBlockView } from "@/modules/ai/blocks/components/NotesBlockView";
import { PracticeBlockView } from "@/modules/ai/blocks/components/PracticeBlockView";
import { TableBlockView } from "@/modules/ai/blocks/components/TableBlockView";

interface BlockRendererProps {
  block: Block;
  onExplainNode?: Parameters<typeof MindmapBlockView>[0]["onExplainNode"];
}

export function BlockRenderer({ block, onExplainNode }: BlockRendererProps) {
  switch (block.kind) {
    case "notes":
      return <NotesBlockView block={block} />;
    case "table":
      return <TableBlockView block={block} />;
    case "flashcards":
      return <FlashcardsBlockView block={block} />;
    case "practice":
      return <PracticeBlockView block={block} />;
    case "callout":
      return <CalloutBlockView block={block} />;
    case "mindmap":
      return <MindmapBlockView block={block} onExplainNode={onExplainNode} />;
    case "chart":
      return <ChartBlockView block={block} />;
    default: {
      // Exhaustiveness: `Block`'s discriminant is closed (schemas.ts), so
      // TS flags this line as a type error if a new kind is added there
      // without a matching case above.
      const unreachable: never = block;
      throw new Error(`Unknown block kind: ${JSON.stringify(unreachable)}`);
    }
  }
}
