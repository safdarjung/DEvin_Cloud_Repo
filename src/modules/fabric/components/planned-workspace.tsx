import Link from "next/link";
import { LimitedBadge } from "@/components/honesty";
import { EmptyState } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { WorkspaceSkeleton } from "./workspace-skeleton";

/**
 * Fabric workspaces with no backend yet. Demo tenants keep the skeleton;
 * real schools get an honest "planned" notice (CLAUDE.md rule 7) and no data.
 */
export function PlannedWorkspace({ demo, packet, name, base }: { demo: boolean; packet: string; name: string; base: string }) {
  if (demo) return <WorkspaceSkeleton packet={packet} />;
  return (
    <div className="space-y-3">
      <LimitedBadge />
      <EmptyState
        title={`${name}: planned, not available yet`}
        description="This workspace has no live data behind it yet, so nothing is shown rather than made-up numbers."
        action={
          <Link href={`${base}/dashboard`} className={buttonVariants({ variant: "outline" })}>
            Back to dashboard
          </Link>
        }
      />
    </div>
  );
}
