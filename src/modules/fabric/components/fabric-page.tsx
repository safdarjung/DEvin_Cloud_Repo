import type { ReactNode } from "react";
import { FadeIn } from "@/components/motion";
import { PageHeader } from "@/components/page-header";

export function FabricPage({
  title,
  description,
  ws,
  actions,
  children,
}: {
  title: string;
  description?: string;
  /** Workspace id, used as a stable test hook. */
  ws: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div data-fabric-ws={ws} className="space-y-4">
      <PageHeader
        title={title}
        description={description}
        actions={actions}
      />
      <FadeIn>{children}</FadeIn>
    </div>
  );
}
