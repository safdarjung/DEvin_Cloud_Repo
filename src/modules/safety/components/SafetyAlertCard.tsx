// Presentational (server-safe). State is always text + icon, never colour alone.
// The message is plain text from the alert row, rendered as text (never HTML).
import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, ClipboardCheck, School, Siren, type LucideIcon } from "lucide-react";
import { SimulatedBadge } from "@/components/honesty";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SafetyAlertRow, SafetyDelivery } from "@/modules/safety/queries";
import type { SafetyKind } from "@/modules/safety/schemas";

const KIND: Record<SafetyKind, { label: string; icon: LucideIcon; variant: "destructive" | "info" | "warning" }> = {
  emergency: { label: "Emergency", icon: Siren, variant: "destructive" },
  drill: { label: "Drill (practice)", icon: ClipboardCheck, variant: "info" },
  closure: { label: "School closure", icon: School, variant: "warning" },
};

const when = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function formatAlertTime(iso: string): string {
  return when.format(new Date(iso));
}

export function KindBadge({ kind }: { kind: SafetyKind }) {
  const k = KIND[kind];
  const Icon = k.icon;
  return (
    <Badge variant={k.variant}>
      <Icon className="size-3.5" aria-hidden />
      {k.label}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: "active" | "closed" }) {
  return status === "active" ? (
    <Badge variant="destructive">
      <CircleAlert className="size-3.5" aria-hidden />
      Active
    </Badge>
  ) : (
    <Badge variant="outline">
      <CircleCheck className="size-3.5" aria-hidden />
      Closed
    </Badge>
  );
}

export function audienceText(alert: Pick<SafetyAlertRow, "audience" | "sectionLabels">): string {
  if (alert.audience === "all") return "Everyone in the school";
  if (alert.audience === "staff") return "Staff only";
  return alert.sectionLabels.length > 0 ? `Sections: ${alert.sectionLabels.join(", ")}` : "Selected sections";
}

/** In-app is real; SMS is simulated (channels in src/modules/notifications). Shown on the send form and alert detail (rule 7). */
export function SafetyDeliveryNote() {
  return (
    <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
      <SimulatedBadge />
      <span>
        In-app notifications are real and are created when you press send: everyone in the audience gets one in FabricOS. If that step fails,
        the alert is still saved and its notifications wait for the job runner. The SMS copy is simulated, so no text message is sent.
        WhatsApp and email are not used for safety alerts. Use your phone tree or PA system as well.
      </span>
    </p>
  );
}

/** Managers only: in-app delivery state from the alert's notify job (text + icon, never colour alone). */
export function SafetyDeliveryState({ delivery }: { delivery: SafetyDelivery }) {
  if (delivery === "sent") {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="success">
          <CircleCheck className="size-3.5" aria-hidden />
          In-app notifications sent
        </Badge>
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      <Badge variant="warning">
        <CircleAlert className="size-3.5" aria-hidden />
        {delivery === "queued" ? "In-app notifications queued, not yet sent" : "In-app notifications failed"}
      </Badge>
      <span className="text-muted-foreground">Run the job runner or check the Jobs page.</span>
    </p>
  );
}

/** An active alert is a live region (`role="alert"`) so screen readers announce it. */
export function SafetyAlertCard({ alert, children }: { alert: SafetyAlertRow; children?: ReactNode }) {
  const active = alert.status === "active";
  return (
    <Card className={active && alert.kind === "emergency" ? "border-destructive" : undefined}>
      <CardHeader className="space-y-2">
        <div role={active ? "alert" : undefined} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <KindBadge kind={alert.kind} />
            <StatusBadge status={alert.status} />
          </div>
          <CardTitle className="text-base">{alert.title}</CardTitle>
          <p className="text-sm whitespace-pre-line">{alert.message}</p>
        </div>
        <p className="text-muted-foreground text-xs">
          {audienceText(alert)} · Sent {formatAlertTime(alert.createdAt)}
          {alert.closedAt ? ` · Closed ${formatAlertTime(alert.closedAt)}` : ""}
        </p>
      </CardHeader>
      {children && <CardContent className="space-y-4">{children}</CardContent>}
    </Card>
  );
}
