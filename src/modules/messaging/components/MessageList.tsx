import { formatIst } from "@/modules/messaging/format";
import type { ThreadMessage } from "@/modules/messaging/queries";
import { AnimatedList } from "@/components/widgets/viz";

export function MessageList({ messages, otherName, senderNames }: { messages: ThreadMessage[]; otherName: string; senderNames?: Record<string, string> }) {
  return (
    <AnimatedList className="space-y-3" ariaLabel="Messages">
      {messages.map((m) => (
        <div key={m.id} className={m.mine ? "ml-auto max-w-[85%]" : "max-w-[85%]"}>
          <div className={`rounded-md border px-3 py-2 ${m.mine ? "border-primary/20 bg-primary/5" : "border-border bg-card"}`}>
            <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
          </div>
          <p className={`mt-1 text-xs text-muted-foreground ${m.mine ? "text-right" : ""}`}>
            {m.mine ? "You" : (senderNames?.[m.senderProfileId] ?? otherName)} · <span className="tabular-nums">{formatIst(m.createdAt)}</span>
          </p>
        </div>
      ))}
    </AnimatedList>
  );
}
