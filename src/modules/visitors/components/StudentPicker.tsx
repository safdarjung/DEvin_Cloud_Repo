"use client";

// Type-ahead student picker; selection goes into the URL so server components can read that student's collectors.
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { StudentSearchSelect } from "@/modules/people/components/StudentSearchSelect";

export function StudentPicker({ tab, selected, institutionSlug, id }: { tab: string; selected?: { id: string; label: string }; institutionSlug: string; id: string }) {
  const router = useRouter();
  return (
    <div className="min-w-56 flex-1 sm:max-w-sm">
      <Label htmlFor={id}>Student</Label>
      <StudentSearchSelect
        institutionSlug={institutionSlug}
        id={id}
        value={selected ?? null}
        onChange={(next) => router.push(`?tab=${tab}${next ? `&student=${next.id}` : ""}`)}
      />
    </div>
  );
}
