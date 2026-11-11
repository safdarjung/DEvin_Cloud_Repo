// Starter pages for a school site, built on the typed block model (blocks.ts)
// and usable with AI off. Text in [square brackets] is a placeholder the
// school replaces; nothing here claims a fact about the school.
import type { Block } from "./blocks";

export const WEBSITE_PAGE_KINDS = ["home", "about", "admissions", "academics", "facilities", "contact"] as const;
export type WebsitePageKind = (typeof WEBSITE_PAGE_KINDS)[number];

export const PAGE_KIND_LABELS: Record<WebsitePageKind, string> = {
  home: "Home",
  about: "About",
  admissions: "Admissions",
  academics: "Academics",
  facilities: "Facilities",
  contact: "Contact",
};

const p = (text: string) => ({ type: "paragraph" as const, spans: [{ text }] });
const h = (text: string) => ({ type: "heading" as const, level: 2 as const, text });
const list = (items: string[], ordered = false) => ({ type: "list" as const, ordered, items });

/** The starter blocks for one page kind; valid against `BlocksSchema` for any institution name. */
export function websiteTemplate(kind: WebsitePageKind, institutionName: string): Block[] {
  // Hero headings cap at 200 chars; keep room for the "Welcome to " prefix.
  const name = institutionName.trim().slice(0, 150) || "our school";

  switch (kind) {
    case "home":
      return [
        {
          type: "hero",
          heading: `Welcome to ${name}`,
          subheading: "A caring school where every child is known, challenged and supported to do their best.",
          cta: { label: "Enquire about admissions", href: "/admissions" },
        },
        {
          type: "stats",
          heading: "At a glance",
          items: [
            { label: "Students", value: "[number]" },
            { label: "Teachers", value: "[number]" },
            { label: "Years of teaching", value: "[number]" },
            { label: "Board", value: "[CBSE / ICSE / State]" },
          ],
        },
        { type: "notice_list", heading: "Latest notices", limit: 5 },
        { type: "event_list", heading: "Upcoming events", limit: 4 },
        { type: "enquiry_form", heading: "Admission enquiry", ctaLabel: "Send enquiry" },
      ];
    case "about":
      return [
        { type: "hero", heading: `About ${name}`, subheading: "Our story, our values and the people who make our school." },
        {
          type: "rich_text",
          nodes: [
            h("Our story"),
            p("[When and why the school was founded, in two or three sentences.]"),
            h("Vision and mission"),
            p("[What the school wants every child to become, and how it works towards that.]"),
            h("Our values"),
            list(["Respect for every child", "Curiosity and hard work", "Honesty and kindness", "Service to the community"]),
            h("From the principal"),
            p("[A short welcome message from the principal.]"),
          ],
        },
      ];
    case "admissions":
      return [
        { type: "hero", heading: "Admissions", subheading: `How admission to ${name} works, and what to keep ready.` },
        {
          type: "rich_text",
          nodes: [
            h("How to apply"),
            list(
              [
                "Send an enquiry using the form on this page.",
                "Visit the school and meet our team.",
                "Submit the application form and documents.",
                "Confirm the seat once the admission decision is shared.",
              ],
              true,
            ),
            h("Documents to keep ready"),
            list([
              "Birth certificate",
              "Previous school report card (if any)",
              "Transfer certificate (Class II and above)",
              "Passport-size photographs",
              "Address proof",
            ]),
          ],
        },
        { type: "notice_list", heading: "Admission notices", limit: 3 },
        { type: "enquiry_form", heading: "Admission enquiry", ctaLabel: "Send enquiry" },
      ];
    case "academics":
      return [
        { type: "hero", heading: "Academics", subheading: "[Board] curriculum from [first class] to [last class], taught with care and clear goals." },
        {
          type: "rich_text",
          nodes: [
            h("Our approach"),
            p("[How teaching works here: class sizes, activity-based learning, regular assessment and feedback to parents.]"),
            h("Stages"),
            list([
              "Pre-primary: learning through play and stories",
              "Primary (Classes I to V): strong foundations in language and maths",
              "Middle (Classes VI to VIII): subjects in depth, projects and labs",
              "Secondary (Classes IX and X): board preparation with regular practice",
            ]),
          ],
        },
        {
          type: "stats",
          heading: "Results",
          items: [
            { label: "Class X pass rate", value: "[%]" },
            { label: "Class XII pass rate", value: "[%]" },
          ],
        },
        { type: "event_list", heading: "Academic calendar", limit: 4 },
      ];
    case "facilities":
      return [
        { type: "hero", heading: "Facilities", subheading: "Safe, well-kept spaces for learning, play and growth." },
        {
          type: "rich_text",
          nodes: [
            h("Classrooms"),
            p("[Size, light and ventilation, smart boards if any.]"),
            h("Library"),
            p("[Number of books, reading hours, reading programmes.]"),
            h("Laboratories"),
            p("[Science, computer and other labs.]"),
            h("Sports and play"),
            p("[Playground, indoor games, coaching.]"),
            h("Transport and safety"),
            p("[Bus routes, CCTV, staff on duty.]"),
          ],
        },
        {
          type: "stats",
          items: [
            { label: "Library books", value: "[number]" },
            { label: "Labs", value: "[number]" },
            { label: "School buses", value: "[number]" },
          ],
        },
      ];
    case "contact":
      return [
        { type: "hero", heading: `Contact ${name}`, subheading: "We are happy to answer your questions. Visit us, call us or send an enquiry." },
        { type: "contact", heading: "Reach us", address: "[School address]", phone: "[phone]" },
        {
          type: "rich_text",
          nodes: [h("Office hours"), list(["Monday to Friday: [9:00 am to 3:00 pm]", "Saturday: [9:00 am to 12:00 pm]"])],
        },
        { type: "enquiry_form", heading: "Admission enquiry", ctaLabel: "Send enquiry" },
      ];
  }
}
