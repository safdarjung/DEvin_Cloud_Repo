"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { assignHouse, awardHousePoints, createHouse, unassignHouse } from "@/modules/clubs/actions";
import { AwardPointsSchema, HouseCreateSchema } from "@/modules/clubs/schemas";
import { FieldError, SELECT_CLASS, useRun } from "./use-run";

type Option = { id: string; label: string };

export function HouseCreateForm({ institutionSlug }: { institutionSlug: string }) {
  const { pending, errors, run, setErrors } = useRun();
  const [f, setF] = useState({ name: "", colour: "#2563EB" });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = HouseCreateSchema.safeParse(f);
    if (!parsed.success) {
      setErrors({ name: parsed.error.issues.map((i) => i.message) });
      return;
    }
    run(() => createHouse(institutionSlug, parsed.data), "House created", () => setF({ ...f, name: "" }));
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3" aria-busy={pending}>
      <div>
        <Label htmlFor="house-name">House name</Label>
        <Input id="house-name" value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <FieldError errors={errors.name} />
      </div>
      <div>
        <Label htmlFor="house-colour">Colour</Label>
        <Input id="house-colour" type="color" value={f.colour} onChange={(e) => setF({ ...f, colour: e.target.value })} className="w-16 p-1" />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        Add house
      </Button>
    </form>
  );
}

export function AssignHouseForm({ institutionSlug, houses, students }: { institutionSlug: string; houses: Option[]; students: Option[] }) {
  const { pending, run } = useRun();
  const [houseId, setHouseId] = useState(houses[0]?.id ?? "");
  const [studentId, setStudentId] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        if (houseId && studentId) run(() => assignHouse(institutionSlug, { houseId, studentId }), "House assigned", () => setStudentId(""));
      }}
    >
      <div className="min-w-48 flex-1">
        <Label htmlFor="as-student">Student</Label>
        <select id="as-student" className={SELECT_CLASS} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">Choose a student</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="as-house">House</Label>
        <select id="as-house" className={SELECT_CLASS} value={houseId} onChange={(e) => setHouseId(e.target.value)}>
          {houses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" size="sm" disabled={pending || !studentId || !houseId}>
        Assign
      </Button>
    </form>
  );
}

export function RemoveFromHouseButton({ institutionSlug, studentId, name }: { institutionSlug: string; studentId: string; name: string }) {
  const { pending, run } = useRun();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={pending}
      aria-label={`Remove ${name} from house`}
      onClick={() => run(() => unassignHouse(institutionSlug, { studentId }), "Removed from house")}
    >
      Remove
    </Button>
  );
}

export function AwardPointsForm({ institutionSlug, houses, members }: { institutionSlug: string; houses: Option[]; members: (Option & { houseId: string })[] }) {
  const { pending, errors, run, setErrors } = useRun();
  const [f, setF] = useState({ houseId: houses[0]?.id ?? "", points: "5", reason: "", studentId: "" });
  const eligible = members.filter((m) => m.houseId === f.houseId);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = AwardPointsSchema.safeParse({ houseId: f.houseId, points: Number(f.points), reason: f.reason, studentId: f.studentId || undefined });
    if (!parsed.success) {
      const flat: Record<string, string[]> = {};
      for (const i of parsed.error.issues) (flat[String(i.path[0] ?? "form")] ??= []).push(i.message);
      setErrors(flat);
      return;
    }
    run(() => awardHousePoints(institutionSlug, parsed.data), "Points recorded", () => setF({ ...f, reason: "", studentId: "" }));
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" aria-busy={pending}>
      <div>
        <Label htmlFor="pt-house">House</Label>
        <select id="pt-house" className={SELECT_CLASS} value={f.houseId} onChange={(e) => setF({ ...f, houseId: e.target.value, studentId: "" })}>
          {houses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="pt-student">Student (optional)</Label>
        <select id="pt-student" className={SELECT_CLASS} value={f.studentId} onChange={(e) => setF({ ...f, studentId: e.target.value })}>
          <option value="">Whole house</option>
          {eligible.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <FieldError errors={errors.studentId} />
      </div>
      <div>
        <Label htmlFor="pt-points">Points (-100 to 100)</Label>
        <Input id="pt-points" type="number" min={-100} max={100} value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} />
        <FieldError errors={errors.points} />
      </div>
      <div>
        <Label htmlFor="pt-reason">Reason</Label>
        <Input id="pt-reason" value={f.reason} maxLength={200} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        <FieldError errors={errors.reason} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending || houses.length === 0}>
          {pending ? "Saving…" : "Award points"}
        </Button>
      </div>
    </form>
  );
}
