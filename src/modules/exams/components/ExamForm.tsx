"use client";

import { Label } from "@/components/ui/label";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActionResult } from "@/lib/actions/result";
import { createExam } from "@/modules/exams/actions";
import type { TermOption } from "@/modules/exams/queries";

const EXAM_TYPES = [
  { value: "unit_test", label: "Unit test" },
  { value: "half_yearly", label: "Half-yearly" },
  { value: "annual", label: "Annual" },
] as const;

interface ExamFormProps {
  institutionSlug: string;
  terms: TermOption[];
  gradingScaleKeys: string[];
}

export function ExamForm({ institutionSlug, terms, gradingScaleKeys }: ExamFormProps) {
  const router = useRouter();
  const [termId, setTermId] = useState(terms[0]?.id ?? "");
  const [type, setType] = useState<(typeof EXAM_TYPES)[number]["value"]>("unit_test");
  const [gradingScaleKey, setGradingScaleKey] = useState(gradingScaleKeys[0] ?? "default");

  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    async (_prev, formData) =>
      createExam(institutionSlug, {
        termId,
        name: String(formData.get("name") ?? "").trim(),
        type,
        gradingScaleKey,
      }),
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      router.push(`/${institutionSlug}/exams/${state.data.id}`);
    }
  }, [state, institutionSlug, router]);

  return (
    <Card className="max-w-xl">
      <CardContent>
    <form action={formAction} className="space-y-4">
      <div>
        <Label className="mb-1 block" htmlFor="termId">
          Term
        </Label>
        <Select value={termId} onValueChange={setTermId}>
          <SelectTrigger id="termId" className="w-full">
            <SelectValue placeholder="Choose a term" />
          </SelectTrigger>
          <SelectContent>
            {terms.map((term) => (
              <SelectItem key={term.id} value={term.id}>
                {term.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="mb-1 block" htmlFor="name">
          Exam name
        </Label>
        <Input id="name" name="name" required maxLength={200} placeholder="Unit Test 2" />
      </div>

      <div>
        <Label className="mb-1 block" htmlFor="type">
          Type
        </Label>
        <Select value={type} onValueChange={(value) => setType(value as typeof type)}>
          <SelectTrigger id="type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXAM_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {gradingScaleKeys.length > 1 && (
        <div>
          <Label className="mb-1 block" htmlFor="gradingScaleKey">
            Grading scale
          </Label>
          <Select value={gradingScaleKey} onValueChange={setGradingScaleKey}>
            <SelectTrigger id="gradingScaleKey" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {gradingScaleKeys.map((key) => (
                <SelectItem key={key} value={key}>
                  {key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {state && !state.ok && (
        <p role="alert" className="text-destructive text-sm">
          {state.error.message}
        </p>
      )}

      <Button type="submit" disabled={pending || !termId}>
        {pending ? "Creating…" : "Create exam"}
      </Button>
    </form>
      </CardContent>
    </Card>
  );
}
