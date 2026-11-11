"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClub, updateClub } from "@/modules/clubs/actions";
import { ClubCreateSchema } from "@/modules/clubs/schemas";
import { FieldError, SELECT_CLASS, useRun } from "./use-run";

type Option = { id: string; label: string };

export function ClubForm({
  institutionSlug,
  staff,
  club,
}: {
  institutionSlug: string;
  staff: Option[];
  club?: { id: string; name: string; description: string | null; patronStaffId: string | null; capacity: number | null; isActive: boolean };
}) {
  const { pending, errors, run, setErrors } = useRun();
  const [f, setF] = useState({
    name: club?.name ?? "",
    description: club?.description ?? "",
    patron: club?.patronStaffId ?? "",
    capacity: club?.capacity ? String(club.capacity) : "",
    active: club?.isActive ?? true,
  });
  const id = club?.id ?? "new";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const capacity = f.capacity ? Number(f.capacity) : undefined;
    if (!club) {
      const parsed = ClubCreateSchema.safeParse({
        name: f.name,
        description: f.description || undefined,
        patronStaffId: f.patron || undefined,
        capacity,
      });
      if (!parsed.success) {
        const flat: Record<string, string[]> = {};
        for (const i of parsed.error.issues) (flat[String(i.path[0] ?? "form")] ??= []).push(i.message);
        setErrors(flat);
        return;
      }
      run(() => createClub(institutionSlug, parsed.data), "Club created", () => setF({ ...f, name: "", description: "", capacity: "" }));
    } else {
      run(
        () =>
          updateClub(institutionSlug, {
            id: club.id,
            name: f.name,
            description: f.description || null,
            patronStaffId: f.patron || null,
            capacity: capacity ?? null,
            isActive: f.active,
          }),
        "Club saved",
      );
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" aria-busy={pending}>
      <div>
        <Label htmlFor={`club-name-${id}`}>Name</Label>
        <Input id={`club-name-${id}`} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} aria-invalid={Boolean(errors.name)} />
        <FieldError errors={errors.name} />
      </div>
      <div>
        <Label htmlFor={`club-patron-${id}`}>Patron (staff)</Label>
        <select id={`club-patron-${id}`} className={SELECT_CLASS} value={f.patron} onChange={(e) => setF({ ...f, patron: e.target.value })}>
          <option value="">None</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={`club-desc-${id}`}>Description</Label>
        <Input id={`club-desc-${id}`} value={f.description} maxLength={500} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <FieldError errors={errors.description} />
      </div>
      <div>
        <Label htmlFor={`club-cap-${id}`}>Capacity (blank = unlimited)</Label>
        <Input id={`club-cap-${id}`} type="number" min={1} max={1000} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />
        <FieldError errors={errors.capacity} />
      </div>
      {club && (
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          Accepting members
        </label>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : club ? "Save changes" : "Create club"}
        </Button>
      </div>
    </form>
  );
}
