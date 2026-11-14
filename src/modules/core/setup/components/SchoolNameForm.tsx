"use client";

// School profile: the school's name as the sidebar, dashboards, report cards and website show it.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveSchoolName } from "@/modules/core/setup/actions";

export function SchoolNameForm({ institutionSlug, name, locked }: { institutionSlug: string; name: string; locked: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        start(async () => {
          const result = await saveSchoolName(institutionSlug, { name: value });
          if (!result.ok) return setMessage({ ok: false, text: result.error.fieldErrors?.name?.[0] ?? result.error.message });
          setMessage({ ok: true, text: "Name saved. The sidebar and dashboards now show it." });
          router.refresh();
        });
      }}
    >
      <div className="flex min-w-64 flex-1 flex-col gap-1.5">
        <Label htmlFor="school-name">School name</Label>
        <Input id="school-name" value={value} maxLength={120} onChange={(e) => setValue(e.target.value)} disabled={locked || pending} required />
      </div>
      <Button type="submit" disabled={locked || pending || value.trim() === name || value.trim().length < 2}>
        {pending ? "Saving…" : "Save name"}
      </Button>
      {locked && <p className="w-full text-xs text-muted-foreground">This is the shared sample school, so its name is fixed in the demo. Your own school can change it here.</p>}
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`w-full text-sm ${message.ok ? "text-muted-foreground" : "text-destructive"}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}
