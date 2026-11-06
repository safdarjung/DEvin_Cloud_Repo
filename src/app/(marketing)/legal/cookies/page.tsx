import { meta } from "@/components/marketing/content";
import { LegalPage } from "@/components/marketing/legal-page";

export const metadata = meta("Cookie notice", "Draft cookie notice for Fabric. Requires legal review.", "/legal/cookies");

const SECTIONS = [
  { h: "Status of this document", p: "This is a working draft prepared for internal review. It is not legal advice and has not been approved for publication." },
  { h: "What this will cover", p: "The cookies and local storage used by the marketing site and the signed-in application, and their purposes." },
  { h: "Known today", p: "The site stores a colour-theme preference in the browser. Signed-in areas use session cookies." },
];

const REVIEW = [
  "Full cookie inventory and categories",
  "Consent mechanism, if any non-essential cookies or analytics are added",
  "Children's data and tracking restrictions under the DPDP Act, 2023",
];

export default function Page() {
  return <LegalPage title="Cookie notice" lead="Which cookies and similar storage the site uses. Draft." sections={SECTIONS} review={REVIEW} />;
}
