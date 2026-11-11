"use client";

// F-UI-11 marketplace catalogue — real module catalog (src/lib/modules/catalog.ts)
// via marketplaceCatalog(ctx), grouped by its real categories. No vendors,
// ratings, or install counts: that data doesn't exist, so it is
// omitted rather than invented (CLAUDE.md rule 7 / live-fabric BRIEF).
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/states";
import { Stagger } from "@/components/motion";
import { LimitedBadge } from "@/components/honesty";
import { downloadFile, toCsv } from "@/modules/fabric/components/download";
import { formatPriceInr, PRICE_NOTE, type ModuleKey } from "@/lib/modules/catalog";
import type { ModuleCategoryGroup, ModuleListItem } from "@/modules/fabric/marketplace.queries";
import { ModuleDetail } from "./module-detail";

interface FlatModule extends ModuleListItem {
  category: ModuleCategoryGroup["category"];
}

const SELECT_CLASS = "h-9 rounded-lg border border-input bg-transparent px-3 text-sm";

export function Catalogue({
  institutionSlug,
  categories,
  canManage,
}: {
  institutionSlug: string;
  categories: ModuleCategoryGroup[];
  canManage: boolean;
}) {
  const allModules: FlatModule[] = useMemo(
    () => categories.flatMap((group) => group.modules.map((mod) => ({ ...mod, category: group.category }))),
    [categories],
  );
  const categoryNames = useMemo(() => categories.map((g) => g.category), [categories]);
  const byKey = useMemo(() => new Map(allModules.map((m) => [m.key, m])), [allModules]);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [installedOnly, setInstalledOnly] = useState(false);
  const [priceFilter, setPriceFilter] = useState<"all" | "included" | "paid">("all");
  const [sort, setSort] = useState<"default" | "asc" | "desc">("default");
  const [selectedKey, setSelectedKey] = useState<ModuleKey | null>(null);

  const filtered = allModules.filter((m) => {
    if (category && m.category !== category) return false;
    if (installedOnly && !m.enabled) return false;
    if (priceFilter === "included" && m.priceInr !== 0) return false;
    if (priceFilter === "paid" && m.priceInr === 0) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!m.label.toLowerCase().includes(q) && !m.description.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  if (sort !== "default") filtered.sort((a, b) => (sort === "asc" ? a.priceInr - b.priceInr : b.priceInr - a.priceInr));

  const monthlyTotal = allModules.reduce((sum, m) => (m.enabled ? sum + m.priceInr : sum), 0);

  const installedCount = allModules.filter((m) => m.enabled).length;
  const selected = selectedKey ? byKey.get(selectedKey) ?? null : null;
  const requiresDetail = (selected?.requires ?? []).map((key) => {
    const dep = byKey.get(key);
    return { key, label: dep?.label ?? key, enabled: dep?.enabled ?? false };
  });

  function clearFilters() {
    setQuery("");
    setCategory(null);
    setInstalledOnly(false);
    setPriceFilter("all");
    setSort("default");
  }

  function exportInstalled() {
    const rows = allModules.filter((m) => m.enabled).map((m) => ({ key: m.key, label: m.label, category: m.category }));
    downloadFile("installed-modules.csv", toCsv(rows), "text/csv");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search modules…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
          aria-label="Search modules"
        />
        <Button type="button" variant={installedOnly ? "default" : "outline"} size="sm" onClick={() => setInstalledOnly((v) => !v)}>
          Installed only ({installedCount})
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={exportInstalled} disabled={installedCount === 0}>
          Export installed
        </Button>
        <select
          value={priceFilter}
          onChange={(e) => setPriceFilter(e.target.value as typeof priceFilter)}
          aria-label="Filter by price"
          className={SELECT_CLASS}
        >
          <option value="all">All prices</option>
          <option value="included">Included only</option>
          <option value="paid">Paid only</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort by price" className={SELECT_CLASS}>
          <option value="default">Default order</option>
          <option value="asc">Price: low to high</option>
          <option value="desc">Price: high to low</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm" role="status">
        <span>
          Monthly total for installed modules: <strong>{formatPriceInr(monthlyTotal)}</strong>
        </span>
        <LimitedBadge />
        <span className="text-xs text-muted-foreground">{PRICE_NOTE}</span>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        <Button type="button" size="sm" variant={category === null ? "default" : "outline"} onClick={() => setCategory(null)}>
          All
        </Button>
        {categoryNames.map((c) => (
          <Button key={c} type="button" size="sm" variant={category === c ? "default" : "outline"} onClick={() => setCategory(c)}>
            {c}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No modules match"
          description="Try a different search or clear the filters."
          action={
            <Button type="button" variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((m) => (
            <Card
              key={m.key}
              role="button"
              tabIndex={0}
              className="cursor-pointer transition hover:border-primary"
              onClick={() => setSelectedKey(m.key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setSelectedKey(m.key);
              }}
            >
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{m.label}</CardTitle>
                  {m.core ? (
                    <Badge variant="secondary">Always on</Badge>
                  ) : m.enabled ? (
                    <Badge variant="success">Installed</Badge>
                  ) : null}
                </div>
                <CardDescription>{m.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {m.category} · <span className="font-medium text-foreground">{formatPriceInr(m.priceInr)}</span>
                </p>
              </CardContent>
            </Card>
          ))}
        </Stagger>
      )}

      {selected && (
        <ModuleDetail
          institutionSlug={institutionSlug}
          module={selected}
          category={selected.category}
          canManage={canManage}
          requiresDetail={requiresDetail}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </div>
  );
}
