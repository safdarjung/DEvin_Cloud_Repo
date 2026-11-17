"use client";

// Hostel controls. Hiding them is UX only: actions re-check hostel.manage and the Zod schema.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { allocateRoom, createRoom, saveRollCall, updateRoom, vacateAllocation } from "@/modules/hostel/actions";
import { StudentSearchSelect } from "@/modules/people/components/StudentSearchSelect";
import type { HostelAllocationRow, HostelRollCallEntryRow, HostelRoomRow } from "@/modules/hostel/queries";
import { ROLL_CALL_STATUSES, type HostelRollCallSaveInput } from "@/modules/hostel/schemas";

const SELECT_CLASS = "h-10 rounded-md border border-input bg-transparent px-3 text-sm";

type Result = { ok: true } | { ok: false; error: Parameters<typeof describeActionError>[0] };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  function run(fn: () => Promise<Result>, success: string, after?: () => void) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(success);
        after?.();
        router.refresh();
      } else toast.error(describeActionError(res.error));
    });
  }
  return { pending, run };
}

export function RoomForm({ institutionSlug, room }: { institutionSlug: string; room?: HostelRoomRow }) {
  const { pending, run } = useRun();
  const [f, setF] = useState({ block: room?.block ?? "", roomNo: room?.roomNo ?? "", capacity: String(room?.capacity ?? 4), isActive: room?.isActive ?? true });
  const id = room?.id ?? "new";
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const base = { block: f.block, roomNo: f.roomNo, capacity: Number(f.capacity) };
    run(
      () => (room ? updateRoom(institutionSlug, { id: room.id, ...base, isActive: f.isActive }) : createRoom(institutionSlug, base)),
      room ? "Room updated" : "Room added",
      () => !room && setF({ ...f, roomNo: "" }),
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3" aria-busy={pending}>
      <div>
        <Label htmlFor={`b-${id}`}>Block</Label>
        <Input id={`b-${id}`} value={f.block} maxLength={60} onChange={(e) => setF({ ...f, block: e.target.value })} className="w-28" />
      </div>
      <div>
        <Label htmlFor={`r-${id}`}>Room no.</Label>
        <Input id={`r-${id}`} value={f.roomNo} maxLength={20} onChange={(e) => setF({ ...f, roomNo: e.target.value })} className="w-24" />
      </div>
      <div>
        <Label htmlFor={`c-${id}`}>Capacity</Label>
        <Input id={`c-${id}`} type="number" min={1} max={50} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} className="w-20" />
      </div>
      {room && (
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
          Active
        </label>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {room ? "Save" : "Add room"}
      </Button>
    </form>
  );
}

export function AllocateForm({ institutionSlug, rooms }: { institutionSlug: string; rooms: HostelRoomRow[] }) {
  const { pending, run } = useRun();
  const [roomId, setRoomId] = useState("");
  const [student, setStudent] = useState<{ id: string; label: string } | null>(null);
  const studentId = student?.id ?? "";
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        run(() => allocateRoom(institutionSlug, { roomId, studentId }), "Student allocated", () => setStudent(null));
      }}
    >
      <div>
        <Label htmlFor="al-room">Room</Label>
        <select id="al-room" className={SELECT_CLASS} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          <option value="">Choose room</option>
          {rooms.filter((r) => r.isActive).map((r) => (
            <option key={r.id} value={r.id} disabled={r.occupied >= r.capacity}>
              {r.block}-{r.roomNo} ({r.occupied}/{r.capacity})
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="al-student">Student</Label>
        <StudentSearchSelect institutionSlug={institutionSlug} id="al-student" value={student} onChange={setStudent} />
      </div>
      <Button type="submit" size="sm" disabled={pending || !roomId || !studentId}>
        Allocate
      </Button>
    </form>
  );
}

export function VacateButton({ institutionSlug, row }: { institutionSlug: string; row: HostelAllocationRow }) {
  const { pending, run } = useRun();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label={`Vacate ${row.studentName} from ${row.room}`}
      onClick={() => run(() => vacateAllocation(institutionSlug, { allocationId: row.id }), "Allocation ended")}
    >
      Vacate
    </Button>
  );
}

export function RollCallForm({
  institutionSlug,
  takenOn,
  session,
  students,
  existing,
}: {
  institutionSlug: string;
  takenOn: string;
  session: HostelRollCallSaveInput["session"];
  students: { id: string; name: string; room: string }[];
  existing: HostelRollCallEntryRow[];
}) {
  const { pending, run } = useRun();
  const [marks, setMarks] = useState<Record<string, HostelRollCallEntryRow["status"]>>(() => {
    const prior = new Map(existing.map((e) => [e.studentId, e.status]));
    return Object.fromEntries(students.map((s) => [s.id, prior.get(s.id) ?? "present"]));
  });
  return (
    <form
      className="space-y-3"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => saveRollCall(institutionSlug, { takenOn, session, entries: students.map((s) => ({ studentId: s.id, status: marks[s.id] ?? "present" })) }),
          "Roll call saved",
        );
      }}
    >
      <ul className="divide-y rounded-md border">
        {students.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="text-sm">
              {s.name} <span className="text-muted-foreground">· {s.room}</span>
            </span>
            <span className="flex gap-3" role="radiogroup" aria-label={`Status for ${s.name}`}>
              {ROLL_CALL_STATUSES.map((st) => (
                <label key={st} className="flex items-center gap-1 text-sm">
                  <input type="radio" name={`st-${s.id}`} checked={marks[s.id] === st} onChange={() => setMarks({ ...marks, [s.id]: st })} />
                  {st === "on_leave" ? "Leave" : st[0].toUpperCase() + st.slice(1)}
                </label>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <Button type="submit" disabled={pending}>
        {existing.length > 0 ? "Update roll call" : "Save roll call"}
      </Button>
    </form>
  );
}
