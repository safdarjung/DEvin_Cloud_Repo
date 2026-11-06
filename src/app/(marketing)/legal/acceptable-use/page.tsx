import { meta } from "@/components/marketing/content";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata = meta("Acceptable use policy", "Draft acceptable use policy for Fabric. Requires legal review.", "/legal/acceptable-use");

const SECTIONS = [
  { h: "Status of this document", p: "This is a working draft prepared for internal review. It is not legal advice and has not been approved for publication." },
  { h: "What this will cover", p: "Prohibited conduct, misuse of AI features, handling of other people's data, and consequences of breach." },
  { h: "AI use", p: "AI output is a suggestion. Users are responsible for what they save or approve." },
];

const REVIEW = [
  "Prohibited content and conduct",
  "Rules for uploading children's data",
  "Enforcement and suspension process",
];

export default function Page() {
  return <LegalPage title="Acceptable use policy" lead="What users may and may not do with Fabric. Draft." sections={SECTIONS} review={REVIEW} />;
}
