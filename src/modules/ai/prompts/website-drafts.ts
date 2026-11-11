// AI website builder prompts. The brief and the page's current blocks go
// inside the shared nonce-delimited data block (./data-block.ts). The only
// school facts sent are its name and what is already on its own public page;
// no student or staff records are read for these prompts.
import type { Block } from "@/modules/website/blocks";
import { PAGE_KIND_LABELS, type WebsitePageKind } from "@/modules/website/templates";
import { HERO_STYLES, THEME_FONTS, THEME_RADII } from "@/modules/website/theme";
import { DATA_IS_NOT_INSTRUCTIONS as DATA_RULE, dataBlock, sanitizeForDataBlock } from "./data-block";

const withDataBlock = (task: string[], data: string[]): string => dataBlock(sanitizeForDataBlock(task.join("\n")), data);

export const WEBSITE_DRAFT_INSTRUCTIONS =
  "You write one public web page for an Indian school as a list of typed blocks (at most 12). Block types: " +
  "'hero' (heading, subheading, optional button label and a link that is a site path such as /admissions, else empty); " +
  "'rich_text' (optional heading, 1 to 10 short paragraphs, optional bullet list); 'stats' (optional heading, 1 to 8 " +
  "label/value pairs, value at most 40 characters); 'notice_list' and 'event_list' (live lists the school fills; give " +
  "only a heading); 'enquiry_form' (the admission enquiry form; heading and button label); 'contact' (heading only; " +
  "the school adds its own address and phone). Use an empty string for anything you leave out. Never invent facts: " +
  "no fees, results, rankings, awards, dates, phone numbers, emails, addresses or names of people. Where the school " +
  "must add a fact, write a placeholder in square brackets, such as [number of students]. Plain text only, no HTML " +
  "or markdown. Respond with JSON only, matching the schema. " +
  DATA_RULE;

export interface WebsiteDraftPromptInput {
  schoolName: string;
  kind: WebsitePageKind;
  tone?: string;
  brief: string;
  currentBlocks?: readonly Block[];
}

export function buildWebsiteDraftPrompt(input: WebsiteDraftPromptInput): string {
  const refine = Boolean(input.currentBlocks?.length);
  return withDataBlock(
    [
      `School name: ${input.schoolName}.`,
      `Page: ${PAGE_KIND_LABELS[input.kind]}. Tone: ${input.tone ?? "warm and clear"}.`,
      refine
        ? "Revise the current page below as the request asks; keep what it does not ask to change."
        : "Draft the page from the request below.",
    ],
    ["Request:", input.brief, ...(refine ? ["Current page blocks (JSON):", JSON.stringify(input.currentBlocks)] : [])],
  );
}

export const WEBSITE_THEME_INSTRUCTIONS =
  "You suggest a look for a school's public website. Give four colours as #rrggbb hex: primary (buttons and links), " +
  "accent (small decorative bars), background and foreground (body text). Body text on the background must have a " +
  "WCAG contrast ratio of at least 4.5:1. Pick headingFont and bodyFont from: " +
  `${Object.entries(THEME_FONTS).map(([key, f]) => `${key} (${f.label})`).join(", ")}. ` +
  `Pick radius from: ${Object.keys(THEME_RADII).join(", ")}. Pick heroStyle from: ${HERO_STYLES.join(", ")} ` +
  "(split: text beside image; centered: centred text; banner: a band in the primary colour). " +
  "Respond with JSON only, matching the schema. " +
  DATA_RULE;

export function buildWebsiteThemePrompt(input: { schoolName: string; brief: string }): string {
  return withDataBlock([`School name: ${input.schoolName}.`, "Suggest a look that fits the description below."], [input.brief]);
}
