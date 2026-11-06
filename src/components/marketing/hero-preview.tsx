import { cn } from "cn";

const BARS = [62, 74, 58, 81, 69, 77, 72];
const PIPE = [
  { label: "Enquiry", w: "100%" },
  { label: "Applied", w: "64%" },
  { label: "Decided", w: "38%" },
  { label: "Enrolled", w: "24%" },
];

/** Decorative HTML/CSS product composition. Shapes only; every figure is labelled sample data. */
export function HeroPreview({ className }: { className?: string }) {
  return (
    <figure className={cn("relative", className)}>
      <div aria-hidden className="overflow-hidden rounded-xl border border-(color:--mk-line) bg-(color:--mk-surface) shadow-[0_24px_60px_-24px_rgb(0_0_0/0.45)]">
        <div className="flex items-center gap-1.5 border-b border-(color:--mk-line) px-4 py-2.5">
          <i className="size-2 rounded-full bg-(color:--mk-line)" />
          <i className="size-2 rounded-full bg-(color:--mk-line)" />
          <i className="size-2 rounded-full bg-(color:--mk-line)" />
          <span className="ml-3 text-[11px] text-(color:--mk-muted)">Principal overview</span>
          <span className="ml-auto rounded border border-(color:--mk-line) px-1.5 text-[10px] text-(color:--mk-muted)">Sample data</span>
        </div>
        <div className="grid grid-cols-[3rem_1fr] sm:grid-cols-[9rem_1fr]">
          <div className="space-y-2 border-r border-(color:--mk-line) p-3">
            {["Overview", "Admissions", "Attendance", "Fees", "Exams"].map((t, i) => (
              <div key={t} className={cn("truncate rounded px-0 py-1.5 text-center text-[11px] sm:px-2 sm:text-left", i === 0 ? "bg-(color:--mk-accent-soft) text-(color:--mk-fg)" : "text-(color:--mk-muted)")}>
                <span className="hidden sm:inline">{t}</span>
                <span className="sm:hidden">{t[0]}</span>
              </div>
            ))}
          </div>
          <div className="space-y-5 p-4">
            <div>
              <p className="text-[11px] text-(color:--mk-muted)">Attendance, last 7 days</p>
              <div className="mt-2 flex h-20 items-end gap-2">
                {BARS.map((h, i) => (
                  <i key={i} style={{ height: `${h}%` }} className="flex-1 rounded-t-sm bg-(color:--mk-accent)/70" />
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] text-(color:--mk-muted)">Admissions pipeline</p>
              <div className="mt-2 space-y-1.5">
                {PIPE.map((p) => (
                  <div key={p.label} className="flex items-center gap-2 text-[10px] text-(color:--mk-muted)">
                    <span className="w-14 shrink-0">{p.label}</span>
                    <i style={{ width: p.w }} className="h-2 rounded-sm bg-(color:--mk-blue)/60" />
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-(color:--mk-accent)/40 bg-(color:--mk-accent-soft) p-3">
              <p className="text-[11px] font-semibold">AI suggestion, awaiting approval</p>
              <p className="mt-1 text-[11px] text-(color:--mk-muted)">Draft reminder for guardians with overdue invoices.</p>
              <div className="mt-2 flex gap-2 text-[10px]">
                <span className="rounded bg-(color:--mk-accent) px-2 py-1 text-(color:--mk-accent-fg)">Review</span>
                <span className="rounded border border-(color:--mk-line) px-2 py-1">Dismiss</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-(color:--mk-muted)">Illustrative composition with sample data. Not a live view.</figcaption>
    </figure>
  );
}
