import type { ReactNode } from "react";
import type { RichTextBlock } from "@/modules/website/blocks";

// Renders the constrained node list built in blocks.ts — never raw HTML
// (07 §1, no `dangerouslySetInnerHTML`). Each node/span maps 1:1 to a React
// element; a `href` on a span already passed `isSafeBlockUrl` at parse time.
export function RichText({ block }: { block: RichTextBlock }) {
  return (
    <section className="max-w-2xl space-y-4 py-8 leading-7 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-4 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-2 [&_h3]:text-xl [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">
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
