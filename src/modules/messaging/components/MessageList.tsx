import { formatIst } from "@/modules/messaging/format";
import type { ThreadMessage } from "@/modules/messaging/queries";

export function MessageList({ messages, otherName }: { messages: ThreadMessage[]; otherName: string }) {
  return (
    <ul className="space-y-3">
      {messages.map((m) => (
        <li key={m.id} className={m.mine ? "ml-auto max-w-[85%]" : "max-w-[85%]"}>
          <div className={`rounded-xl border px-3 py-2 ${m.mine ? "bg-muted" : ""}`}>
            <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
          </div>
          <p className={`mt-1 text-xs text-muted-foreground ${m.mine ? "text-right" : ""}`}>
            {m.mine ? "You" : otherName} · <span className="tabular-nums">{formatIst(m.createdAt)}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}
