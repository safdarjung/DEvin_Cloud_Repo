// Client-safe preview of unsaved blocks with a theme applied — the same
// per-type components the public site renders (blocks/*), inside the same
// themed wrapper the public layout uses. Notice/event lists read the DB on
// the server and the enquiry form submits for real, so those three show a
// placeholder here; the server "Preview (last saved version)" renders them live.
import { parseBlocksSafely, type Block } from "@/modules/website/blocks";
import { THEMED_SITE_CLASS, websiteThemeStyle, type WebsiteTheme } from "@/modules/website/theme";
import { Contact } from "./blocks/Contact";
import { Hero } from "./blocks/Hero";
import { ImageBlock } from "./blocks/ImageBlock";
import { RichText } from "./blocks/RichText";
import { Stats } from "./blocks/Stats";

function Placeholder({ text }: { text: string }) {
  return <div className="my-6 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">{text}</div>;
}

function PreviewBlock({ block }: { block: Block }) {
  switch (block.type) {
    case "hero":
      return <Hero block={block} />;
    case "rich_text":
      return <RichText block={block} />;
    case "image":
      return <ImageBlock block={block} />;
    case "stats":
      return <Stats block={block} />;
    case "contact":
      return <Contact block={block} />;
    case "notice_list":
      return <Placeholder text={`${block.heading ?? "Notices"}: your latest public notices appear here.`} />;
    case "event_list":
      return <Placeholder text={`${block.heading ?? "Events"}: your upcoming public events appear here.`} />;
    case "enquiry_form":
      return <Placeholder text={`${block.heading ?? "Admission enquiry"}: the enquiry form appears here.`} />;
  }
}

export function LivePreview({ blocks, theme }: { blocks: Block[]; theme: WebsiteTheme }) {
  // Mid-edit blocks can be momentarily invalid; skip them rather than throw (same rule as the public renderer).
  const safeBlocks = parseBlocksSafely(blocks);
  return (
    <div className={`${THEMED_SITE_CLASS} min-w-0 overflow-hidden rounded-lg border px-4 text-base`} style={websiteThemeStyle(theme)} data-hero={theme.heroStyle}>
      {safeBlocks.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No valid blocks yet.</p>
      ) : (
        safeBlocks.map((block, index) => <PreviewBlock key={index} block={block} />)
      )}
    </div>
  );
}
