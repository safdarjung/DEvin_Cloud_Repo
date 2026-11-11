// 0141 — Plan tab: pick a version, see its rule checklist, apply suggestions
// (with reasons and before/after impact), publish (a note when rules are
// broken), snapshots, and Compare with… / restore an earlier version.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Violation } from "@/modules/timetable/checks";
import type { CompareRow, SnapshotRow, VersionRow } from "@/modules/timetable/control.queries";
import { RULE_CATALOG } from "@/modules/timetable/rules";
import type { suggestTimetableFill } from "@/modules/timetable/suggest.queries";
import { formatWhen } from "./change-why";
import { NewDraftForm, PublishForm, RestoreVersionForm, SnapshotCreateForm, SnapshotRestoreButton, SuggestionsApply } from "./control-forms";

const FIELD = "h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm sm:h-9 sm:w-auto";
const STATUS_TONE = { draft: "warning", published: "success", archived: "secondary" } as const;

type Suggest = Awaited<ReturnType<typeof suggestTimetableFill>>;

const CHECKLIST_MAX = 25;

/** Violations grouped by rule (checklist order), the selected section's first. */
function groupByRule(violations: Violation[], sectionId?: string): [Violation["rule"], Violation[]][] {
  const groups = new Map<Violation["rule"], Violation[]>();
  for (const v of violations) groups.set(v.rule, [...(groups.get(v.rule) ?? []), v]);
  return [...groups].map(([rule, list]) => [rule, [...list].sort((a, b) => Number(b.sectionId === sectionId) - Number(a.sectionId === sectionId))]);
}

export function PlanPanel({
  slug,
  timeZone,
  sectionId,
  versions,
  version,
  published,
  violations,
  suggest,
  snapshots,
  compare,
}: {
  slug: string;
  timeZone: string;
  sectionId?: string;
  versions: VersionRow[];
  version: VersionRow;
  published?: VersionRow;
  violations: Violation[];
  suggest: Suggest | null;
  snapshots: SnapshotRow[];
  compare: { other: VersionRow; rows: CompareRow[] } | null;
}) {
  const hidden = (
    <>
      <input type="hidden" name="tab" value="plan" />
      {sectionId && <input type="hidden" name="section" value={sectionId} />}
    </>
  );
  const others = versions.filter((v) => v.id !== version.id);
  const resolved = suggest ? suggest.impact.sections.reduce((n, s) => n + s.violationsBefore - s.violationsAfter, 0) : 0;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {version.name} <Badge variant={STATUS_TONE[version.status]}>{version.status}</Badge>
          </CardTitle>
          <CardDescription>
            {version.status === "published"
              ? "The timetable everyone sees. Edits here need a note."
              : version.status === "draft"
                ? "A draft: try edits and suggestions here, then publish."
                : "An earlier timetable, kept for history. Restore it to make it current again."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
            {hidden}
            <label className="grid gap-1 text-sm">
              Version
              <select name="version" defaultValue={version.id} className={FIELD}>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.status})
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="outline" className="min-h-11 sm:min-h-9">
              Open
            </Button>
          </form>
          <NewDraftForm slug={slug} academicYearId={version.academicYearId} copyFromVersionId={published?.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rule checklist</CardTitle>
          <CardDescription>Every enabled rule this version breaks. Double-booking can never happen: the database refuses it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {violations.length === 0 ? (
            <p className="text-sm">
              <Badge variant="success">All clear</Badge> No enabled rule is broken.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {groupByRule(violations, sectionId).map(([rule, list]) => (
                <li key={rule}>
                  <details>
                    <summary className="flex min-h-9 cursor-pointer flex-wrap items-center gap-2">
                      <Badge variant="warning">{RULE_CATALOG[rule].label}</Badge>
                      <span>
                        {list.length} issue{list.length === 1 ? "" : "s"} — e.g. {list[0].message}
                      </span>
                    </summary>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                      {list.slice(0, CHECKLIST_MAX).map((v, i) => (
                        <li key={i}>{v.message}</li>
                      ))}
                      {list.length > CHECKLIST_MAX && <li>…and {list.length - CHECKLIST_MAX} more</li>}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )}
          {version.status === "draft" && <PublishForm slug={slug} versionId={version.id} violations={violations.length} />}
          {version.status === "archived" && <RestoreVersionForm slug={slug} versionId={version.id} name={version.name} />}
        </CardContent>
      </Card>

      {suggest && (
        <Card>
          <CardHeader>
            <CardTitle>Suggestions</CardTitle>
            <CardDescription>
              {suggest.suggestions.length} suggestion{suggest.suggestions.length === 1 ? "" : "s"} for this section&apos;s free periods
              {suggest.truncated ? " (more after these)" : ""}. Each follows the school&apos;s rules and says why; nothing changes until you apply.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm font-medium" role="status">
              {suggest.suggestions.length} suggestion{suggest.suggestions.length === 1 ? "" : "s"} · {suggest.impact.sections.length} section
              {suggest.impact.sections.length === 1 ? "" : "s"} affected · {resolved} rule issue{resolved === 1 ? "" : "s"} resolved if you apply all
            </p>
            {suggest.impact.sections.length > 0 && (
              <div className="max-h-72 overflow-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <caption className="mb-1 text-left text-xs text-muted-foreground">If you apply all: free periods and rule issues before → after (0 clashes)</caption>
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">Section / teacher</th>
                      <th className="py-1 pr-3 font-medium">Free periods</th>
                      <th className="py-1 font-medium">Rule issues / load</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suggest.impact.sections.map((s) => (
                      <tr key={s.id} className="border-t border-border">
                        <td className="py-1 pr-3">{s.label}</td>
                        <td className="py-1 pr-3 tabular-nums">
                          {s.emptyBefore} → {s.emptyAfter}
                        </td>
                        <td className="py-1 tabular-nums">
                          {s.violationsBefore} → {s.violationsAfter}
                        </td>
                      </tr>
                    ))}
                    {suggest.impact.teachers.map((t) => (
                      <tr key={t.id} className="border-t border-border">
                        <td className="py-1 pr-3">{t.name}</td>
                        <td className="py-1 pr-3 text-muted-foreground">—</td>
                        <td className="py-1 tabular-nums">
                          {t.periodsBefore} → {t.periodsAfter} periods/week{t.cap ? ` (max ${t.cap})` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {suggest.suggestions.length > 0 ? (
              <SuggestionsApply
                slug={slug}
                versionId={version.id}
                suggestions={suggest.suggestions}
                sectionLabels={Object.fromEntries(suggest.impact.sections.map((s) => [s.id, s.label]))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No suggestion fits the current rules.</p>
            )}
            {suggest.blocked.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-primary underline-offset-4 hover:underline">
                  Why are {suggest.blocked.length} free period{suggest.blocked.length === 1 ? "" : "s"} still empty?
                </summary>
                <ul className="mt-2 space-y-2">
                  {suggest.blocked.slice(0, CHECKLIST_MAX).map((b) => (
                    <li key={`${b.classSectionId}-${b.weekday}-${b.periodId}`}>
                      <span className="font-medium">{b.label}</span>
                      <ul className="list-disc pl-5 text-muted-foreground">
                        {b.reasons.map((r) => (
                          <li key={`${r.teacherId}-${r.subject}`}>
                            {r.subject} with {r.teacher}: {r.reason}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                  {suggest.blocked.length > CHECKLIST_MAX && <li className="text-muted-foreground">…and {suggest.blocked.length - CHECKLIST_MAX} more</li>}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Snapshots</CardTitle>
          <CardDescription>Save this version as it is now (&ldquo;before exam week&rdquo;) and bring it back later. Restoring logs every period it changes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {version.status !== "archived" && <SnapshotCreateForm slug={slug} versionId={version.id} />}
          {snapshots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No snapshots of this version yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {snapshots.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-sm">
                  <span>
                    <span className="font-medium">{s.name}</span>{" "}
                    <span className="text-muted-foreground">
                      · {s.slotCount} periods · {formatWhen(s.createdAt, timeZone)}
                    </span>
                  </span>
                  {version.status !== "archived" && <SnapshotRestoreButton slug={slug} snapshotId={s.id} name={s.name} published={version.status === "published"} />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compare with…</CardTitle>
          <CardDescription>Period-by-period differences between this version and another, before you restore anything.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {others.length === 0 ? (
            <p className="text-sm text-muted-foreground">There is no other version to compare with.</p>
          ) : (
            <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
              {hidden}
              <input type="hidden" name="version" value={version.id} />
              <label className="grid gap-1 text-sm">
                Compare with
                <select name="compare" defaultValue={compare?.other.id ?? others[0].id} className={FIELD}>
                  {others.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.status})
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="outline" className="min-h-11 sm:min-h-9">
                Compare
              </Button>
            </form>
          )}
          {compare && (
            <>
              <p className="text-sm">
                Going from <span className="font-medium">{version.name}</span> to <span className="font-medium">{compare.other.name}</span>:{" "}
                {compare.rows.length} period{compare.rows.length === 1 ? "" : "s"} differ.
              </p>
              {compare.rows.length > 0 && (
                <div className="max-h-96 overflow-auto rounded-md border border-border">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="sticky top-0 bg-secondary text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Period</th>
                        <th className="px-2 py-1.5 font-medium">{version.name}</th>
                        <th className="px-2 py-1.5 font-medium">{compare.other.name}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compare.rows.slice(0, 300).map((r) => (
                        <tr key={`${r.classSectionId}-${r.weekday}-${r.periodId}`} className="border-t border-border">
                          <td className="px-2 py-1.5">{r.label}</td>
                          <td className="px-2 py-1.5">{r.beforeText ?? <span className="text-muted-foreground">free</span>}</td>
                          <td className="px-2 py-1.5">{r.afterText ?? <span className="text-muted-foreground">free</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {compare.other.status === "archived" && <RestoreVersionForm slug={slug} versionId={compare.other.id} name={compare.other.name} />}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
