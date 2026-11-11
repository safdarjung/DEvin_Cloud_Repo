"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { describeActionError } from "@/lib/action-error";
import type { ActionResult } from "@/lib/actions/result";

/** Runs an action, toasts the outcome, refreshes the server page on success. */
export function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  function run<T>(call: () => Promise<ActionResult<T>>, okMessage: string, onOk?: () => void) {
    start(async () => {
      setErrors({});
      const res = await call();
      if (res.ok) {
        toast.success(okMessage);
        onOk?.();
        router.refresh();
      } else {
        if (res.error.fieldErrors) setErrors(res.error.fieldErrors);
        toast.error(describeActionError(res.error));
      }
    });
  }
  return { pending, errors, run, setErrors };
}

export const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";

export function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {errors.join(" ")}
    </p>
  );
}

/** IST wall-clock `datetime-local` value to an offset ISO string; empty stays undefined. */
export function istIso(local: string): string | undefined {
  return local ? `${local}:00+05:30` : undefined;
}
