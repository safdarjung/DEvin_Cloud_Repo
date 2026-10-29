import type { ReactNode } from "react";
import type { RichTextBlock } from "@/modules/website/blocks";

// Renders the constrained node list built in blocks.ts — never raw HTML
// (07 §1, no `dangerouslySetInnerHTML`). Each node/span maps 1:1 to a React
// element; a `href` on a span already passed `isSafeBlockUrl` at parse time.
export function RichText({ block }: { block: RichTextBlock }) {
  return (
    <section className="prose mx-auto max-w-2xl space-y-4 py-8">
      {block.nodes.map((node, index) => {
        if (node.type === "heading") {
          const HeadingTag = node.level === 2 ? "h2" : "h3";
          return <HeadingTag key={index}>{node.text}</HeadingTag>;
        }
        if (node.type === "list") {
          const ListTag = node.ordered ? "ol" : "ul";
          return (
            <ListTag key={index}>
              {node.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ListTag>
          );
        }
        return (
          <p key={index}>
            {node.spans.map((span, spanIndex) => {
              let content: ReactNode = span.text;
              if (span.bold) content = <strong>{content}</strong>;
              if (span.italic) content = <em>{content}</em>;
              if (span.href) content = <a href={span.href}>{content}</a>;
              return <span key={spanIndex}>{content}</span>;
            })}
          </p>
        );
      })}
    </section>
  );
}
