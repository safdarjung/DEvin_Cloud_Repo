"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { describeActionError } from "@/lib/action-error";
import { deleteStudyMaterial, deleteTeacherStudyMaterial } from "@/modules/study/actions";

/** Deletes the caller's own study item after a confirm, then goes to `afterHref` (or refreshes). */
export function DeleteMaterialButton({ institutionSlug, materialId, audience, afterHref }: {
  institutionSlug: string;
  materialId: string;
  audience: "student" | "teacher";
  afterHref?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(audience === "teacher" ? "Delete this material? Students lose access and their review progress on it." : "Delete this item from your library?")) return;
        start(async () => {
          const res = audience === "teacher" ? await deleteTeacherStudyMaterial(institutionSlug, { materialId }) : await deleteStudyMaterial(institutionSlug, { materialId });
          if (!res.ok) {
            toast.error(describeActionError(res.error));
            return;
          }
          toast.success("Deleted.");
          if (afterHref) router.push(afterHref);
          else router.refresh();
        });
      }}
    >
      {pending ? "Deleting…" : "Delete"}
    </Button>
  );
}
