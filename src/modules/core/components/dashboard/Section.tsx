// Moved into the shared widget frame; kept so existing dashboard imports work.
import type { ReactNode } from "react";
import { Widget } from "@/components/widgets/widget";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <Widget title={title}>{children}</Widget>;
}
