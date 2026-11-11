"use client";

import { LimitedBadge } from "@/components/honesty";
import { formatPriceInr, PRICE_NOTE } from "@/lib/modules/catalog";
import { CheckIcon, XIcon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ModuleListItem } from "@/modules/fabric/marketplace.queries";
import { InstallButton } from "./install-button";

interface RequiresDetail {
  key: string;
  label: string;
  enabled: boolean;
}

export function ModuleDetail({
  institutionSlug,
  module,
  category,
  canManage,
  requiresDetail,
  onClose,
}: {
  institutionSlug: string;
  module: ModuleListItem;
  category: string;
  canManage: boolean;
  requiresDetail: RequiresDetail[];
  onClose: () => void;
}) {
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{module.label}</SheetTitle>
          <SheetDescription>{module.description}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-4">
          <InstallButton institutionSlug={institutionSlug} module={module} canManage={canManage} />

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="requirements">Requirements</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-3 text-sm">
              <p>
                <span className="text-muted-foreground">Category:</span> {category}
              </p>
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">Price:</span> <strong>{formatPriceInr(module.priceInr)}</strong>
                <LimitedBadge />
                <span className="text-xs text-muted-foreground">{PRICE_NOTE}</span>
              </p>
              {module.options.length > 0 && (
                <div>
                  <p className="font-medium">Features</p>
                  <ul className="list-disc pl-5">
                    {module.options.map((opt) => (
                      <li key={opt.key}>
                        {opt.label} — {opt.enabled ? "on" : "off"}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </TabsContent>

            <TabsContent value="requirements" className="space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-md border p-2">
                <span>Permission to install/disable: institution.settings.manage</span>
                {canManage ? (
                  <CheckIcon className="size-4 text-success" aria-label="You hold this permission" />
                ) : (
                  <XIcon className="size-4 text-destructive" aria-label="You do not hold this permission" />
                )}
              </div>
              {requiresDetail.length === 0 ? (
                <p className="text-muted-foreground">No module dependencies.</p>
              ) : (
                <ul className="space-y-2">
                  {requiresDetail.map((dep) => (
                    <li key={dep.key} className="flex items-center justify-between rounded-md border p-2">
                      <span>{dep.label}</span>
                      {dep.enabled ? (
                        <CheckIcon className="size-4 text-success" aria-label={`${dep.label} is enabled`} />
                      ) : (
                        <XIcon className="size-4 text-destructive" aria-label={`${dep.label} is not enabled`} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
