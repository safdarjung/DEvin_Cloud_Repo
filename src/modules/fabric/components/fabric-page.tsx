import type { ReactNode } from "react";
import { FadeIn } from "@/components/motion";
import { PageHeader } from "@/components/page-header";
import { DemoStoreControls } from "./demo-store-controls";

/** UTC midnight today — fixtures must get the same `now` on server and client. */
export function startOfToday(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

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
        actions={
          <>
            {actions}
            <DemoStoreControls />
          </>
        }
      />
      <FadeIn>{children}</FadeIn>
    </div>
  );
}
