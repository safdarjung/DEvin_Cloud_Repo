import Link from "next/link";
import type { TermCollectionSummary } from "@/modules/finance/queries";
import { CollectionsChart } from "./CollectionsChart";
import { Section } from "./Section";

export function FinanceSection({ collections, basePath, showLinks = false }: { collections: TermCollectionSummary; basePath: string; showLinks?: boolean }) {
  return (
    <Section title="Fee collection this term">
      <CollectionsChart collectedPaise={collections.collectedPaise} duePaise={collections.duePaise} />
      {showLinks && (
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <Link href={`${basePath}/finance/defaulters`} className="font-medium underline-offset-4 hover:underline">
            View defaulters
          </Link>
          <Link href={`${basePath}/finance/invoices`} className="font-medium underline-offset-4 hover:underline">
            View invoices
          </Link>
        </div>
      )}
    </Section>
  );
}
