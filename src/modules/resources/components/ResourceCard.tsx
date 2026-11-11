import { Badge } from "@/components/ui/badge";
import { humanize } from "@/lib/format";
import type { ResourceRow } from "@/modules/resources/queries";
import { isSafeHttpsUrl } from "@/modules/resources/schemas";
import { DownloadFileButton } from "./ResourceForms";

// Title and description render as text. A link is only an <a> when it is a safe https URL (re-checked
// here even though Zod and the DB already refuse anything else); files go through the signed read URL.
export function ResourceBody({ resource, institutionSlug, children }: { resource: ResourceRow; institutionSlug: string; children?: React.ReactNode }) {
  const linkOk = resource.url !== null && isSafeHttpsUrl(resource.url);
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <p className="font-medium break-words">{resource.title}</p>
        <p className="text-muted-foreground text-xs">
          <Badge variant="outline">{humanize(resource.kind)}</Badge> {resource.unitTitle ? `Unit: ${resource.unitTitle}` : null}
        </p>
        {resource.description && <p className="text-sm break-words">{resource.description}</p>}
        {resource.url &&
          (linkOk ? (
            <a href={resource.url} target="_blank" rel="noopener noreferrer" className="text-primary text-sm break-all underline-offset-2 hover:underline">
              {resource.url}
            </a>
          ) : (
            <span className="text-muted-foreground text-sm break-all">{resource.url} (link blocked: not https)</span>
          ))}
        {resource.kind === "file" && resource.fileName && <p className="text-muted-foreground text-xs">{resource.fileName}</p>}
      </div>
      <div className="flex items-center gap-2">
        {resource.kind === "file" && resource.documentId && resource.fileName && (
          <DownloadFileButton institutionSlug={institutionSlug} documentId={resource.documentId} fileName={resource.fileName} />
        )}
        {children}
      </div>
    </div>
  );
}
