"use client";

// Ledger / Tally voucher export: builds a download link to the existing `feePlans.ledgerExport` query (?format=csv).
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const today = () => new Date().toISOString().slice(0, 10);

export function LedgerExport({ institutionSlug }: { institutionSlug: string }) {
  const [f, setF] = useState({ from: today().slice(0, 8) + "01", to: today(), layout: "tally", include: "receipts" });
  const days = (Date.parse(f.to) - Date.parse(f.from)) / 86_400_000 + 1;
  const valid = Boolean(f.from && f.to) && days >= 1 && days <= 366;
  const href = `/api/v1/query/feePlans.ledgerExport?format=csv&institution=${encodeURIComponent(institutionSlug)}&input=${encodeURIComponent(JSON.stringify(f))}`;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <Label htmlFor="lx-from">From</Label>
          <Input id="lx-from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="lx-to">To</Label>
          <Input id="lx-to" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="lx-layout">Layout</Label>
          <select id="lx-layout" value={f.layout} onChange={(e) => setF({ ...f, layout: e.target.value })} className="block h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="tally">Tally vouchers</option>
            <option value="plain">Plain ledger</option>
          </select>
        </div>
        <div>
          <Label htmlFor="lx-include">Include</Label>
          <select id="lx-include" value={f.include} onChange={(e) => setF({ ...f, include: e.target.value })} className="block h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="receipts">Receipts only</option>
            <option value="all">All entries</option>
          </select>
        </div>
      </div>
      {valid ? (
        <a href={href} download className="inline-flex min-h-10 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-accent">
          Download CSV
        </a>
      ) : (
        <p role="alert" className="text-sm text-destructive">
          Pick a date range of 1 to 366 days, from before to.
        </p>
      )}
    </div>
  );
}
