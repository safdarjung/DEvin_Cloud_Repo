"use client";

// Hiding these is UX only: actions re-check alumni.manage, Zod and RLS.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { syncAlumni, updateAlumniProfile } from "@/modules/alumni/actions";
import { AlumniUpdateSchema } from "@/modules/alumni/schemas";

export function SyncAlumniButton({ institutionSlug }: { institutionSlug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await syncAlumni(institutionSlug, {});
          if (res.ok) {
            toast.success(res.data.added === 0 ? "Already up to date. 0 added." : `${res.data.added} alumni added`);
            router.refresh();
          } else toast.error(describeActionError(res.error));
        })
      }
    >
      {pending ? "Syncing..." : "Sync from graduated students"}
    </Button>
  );
}

export interface AlumniContact {
  id: string;
  contactEmail: string | null;
  contactPhone: string | null;
  occupation: string | null;
  city: string | null;
}

export function EditAlumniForm({ institutionSlug, alumni }: { institutionSlug: string; alumni: AlumniContact }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = AlumniUpdateSchema.safeParse({
      id: alumni.id,
      contactEmail: String(fd.get("contactEmail") ?? ""),
      contactPhone: String(fd.get("contactPhone") ?? ""),
      occupation: String(fd.get("occupation") ?? ""),
      city: String(fd.get("city") ?? ""),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(" "));
      return;
    }
    setError(null);
    start(async () => {
      const res = await updateAlumniProfile(institutionSlug, parsed.data);
      if (res.ok) {
        toast.success("Contact details saved");
        router.refresh();
      } else setError(describeActionError(res.error));
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" aria-busy={pending}>
      <div>
        <Label htmlFor={`al-email-${alumni.id}`}>Email</Label>
        <Input id={`al-email-${alumni.id}`} name="contactEmail" type="email" maxLength={254} defaultValue={alumni.contactEmail ?? ""} />
      </div>
      <div>
        <Label htmlFor={`al-phone-${alumni.id}`}>Mobile</Label>
        <Input id={`al-phone-${alumni.id}`} name="contactPhone" inputMode="numeric" maxLength={10} defaultValue={alumni.contactPhone ?? ""} />
      </div>
      <div>
        <Label htmlFor={`al-occ-${alumni.id}`}>Occupation</Label>
        <Input id={`al-occ-${alumni.id}`} name="occupation" maxLength={120} defaultValue={alumni.occupation ?? ""} />
      </div>
      <div>
        <Label htmlFor={`al-city-${alumni.id}`}>City</Label>
        <Input id={`al-city-${alumni.id}`} name="city" maxLength={80} defaultValue={alumni.city ?? ""} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </Button>
      </div>
    </form>
  );
}
