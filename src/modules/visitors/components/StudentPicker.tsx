// Plain GET form: picks a student by URL so server components can read that student's collectors.
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SELECT_CLASS } from "./field";

export function StudentPicker({ tab, selected, students, id }: { tab: string; selected?: string; students: { id: string; label: string }[]; id: string }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="tab" value={tab} />
      <div className="min-w-56 flex-1 sm:max-w-sm">
        <Label htmlFor={id}>Student</Label>
        <select id={id} name="student" defaultValue={selected ?? ""} className={SELECT_CLASS}>
          <option value="">Choose a student…</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="outline">
        Select
      </Button>
    </form>
  );
}
