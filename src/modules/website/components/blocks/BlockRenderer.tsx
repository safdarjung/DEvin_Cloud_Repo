import type { Block } from "@/modules/website/blocks";
import { Contact } from "./Contact";
import { EnquiryForm } from "./EnquiryForm";
import { EventList } from "./EventList";
import { Hero } from "./Hero";
import { ImageBlock } from "./ImageBlock";
import { NoticeList } from "./NoticeList";
import { RichText } from "./RichText";
import { Stats } from "./Stats";

// One renderer per block type (04 §6). `blocks` already passed through
// `parseBlocksSafely` (blocks.ts), so every entry here is a valid, known
// block — an unknown or invalid one was already dropped before this ever
// runs (packet rule: "skip unknown or invalid blocks safely").
export function BlockRenderer({ blocks, slug, institutionId }: { blocks: Block[]; slug: string; institutionId: string }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case "hero":
            return <Hero key={index} block={block} />;
          case "rich_text":
            return <RichText key={index} block={block} />;
          case "image":
            return <ImageBlock key={index} block={block} />;
          case "stats":
            return <Stats key={index} block={block} />;
          case "notice_list":
            return <NoticeList key={index} block={block} institutionId={institutionId} />;
          case "event_list":
            return <EventList key={index} block={block} institutionId={institutionId} />;
          case "enquiry_form":
            return <EnquiryForm key={index} block={block} slug={slug} />;
          case "contact":
            return <Contact key={index} block={block} />;
          default:
            return null;
        }
      })}
    </>
  );
}
