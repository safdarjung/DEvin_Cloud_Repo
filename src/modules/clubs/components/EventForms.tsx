"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cancelClubEvent, createClubEvent } from "@/modules/clubs/actions";
import { ClubEventCreateSchema } from "@/modules/clubs/schemas";
import { FieldError, SELECT_CLASS, istIso, useRun } from "./use-run";

export function EventForm({ institutionSlug, clubs }: { institutionSlug: string; clubs: { id: string; name: string }[] }) {
  const { pending, errors, run, setErrors } = useRun();
  const blank = { clubId: clubs[0]?.id ?? "", title: "", venue: "", startsAt: "", endsAt: "", signupClosesAt: "", capacity: "" };
  const [f, setF] = useState(blank);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = ClubEventCreateSchema.safeParse({
      clubId: f.clubId,
      title: f.title,
      venue: f.venue || undefined,
      startsAt: istIso(f.startsAt),
      endsAt: istIso(f.endsAt),
      signupClosesAt: istIso(f.signupClosesAt),
      capacity: f.capacity ? Number(f.capacity) : undefined,
    });
    if (!parsed.success) {
      const flat: Record<string, string[]> = {};
      for (const i of parsed.error.issues) (flat[String(i.path[0] ?? "form")] ??= []).push(i.message);
      setErrors(flat);
      return;
    }
    run(() => createClubEvent(institutionSlug, parsed.data), "Event created", () => setF({ ...blank, clubId: f.clubId }));
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" aria-busy={pending}>
      <div>
        <Label htmlFor="ev-club">Club</Label>
        <select id="ev-club" className={SELECT_CLASS} value={f.clubId} onChange={(e) => setF({ ...f, clubId: e.target.value })}>
          {clubs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <FieldError errors={errors.clubId} />
      </div>
      <div>
        <Label htmlFor="ev-title">Title</Label>
        <Input id="ev-title" value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <FieldError errors={errors.title} />
      </div>
      <div>
        <Label htmlFor="ev-start">Starts</Label>
        <Input id="ev-start" type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />
        <FieldError errors={errors.startsAt} />
      </div>
      <div>
        <Label htmlFor="ev-end">Ends (optional)</Label>
        <Input id="ev-end" type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
        <FieldError errors={errors.endsAt} />
      </div>
      <div>
        <Label htmlFor="ev-close">Sign-up closes (optional)</Label>
        <Input id="ev-close" type="datetime-local" value={f.signupClosesAt} onChange={(e) => setF({ ...f, signupClosesAt: e.target.value })} />
        <FieldError errors={errors.signupClosesAt} />
      </div>
      <div>
        <Label htmlFor="ev-venue">Venue</Label>
        <Input id="ev-venue" value={f.venue} maxLength={120} onChange={(e) => setF({ ...f, venue: e.target.value })} />
      </div>
      <div>
        <Label htmlFor="ev-cap">Capacity (blank = unlimited)</Label>
        <Input id="ev-cap" type="number" min={1} max={1000} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />
        <FieldError errors={errors.capacity} />
      </div>
      <div className="self-end">
        <Button type="submit" size="sm" disabled={pending || clubs.length === 0}>
          {pending ? "Saving…" : "Create event"}
        </Button>
      </div>
    </form>
  );
}

export function CancelEventButton({ institutionSlug, eventId, title }: { institutionSlug: string; eventId: string; title: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label={`Cancel event ${title}`}
      onClick={() => run(() => cancelClubEvent(institutionSlug, { id: eventId }), "Event cancelled")}
    >
      Cancel event
    </Button>
  );
}
