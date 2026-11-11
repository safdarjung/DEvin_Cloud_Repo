// Shared bits for the visitors forms.
export const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";

export function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p role="alert" className="mt-1 text-xs text-destructive">
      {errors.join(" ")}
    </p>
  );
}

/** Flatten Zod issues to the `{ field: [messages] }` shape ActionResult uses. */
export function flattenIssues(issues: { path: PropertyKey[]; message: string }[]): Record<string, string[]> {
  const flat: Record<string, string[]> = {};
  for (const issue of issues) (flat[String(issue.path[0] ?? "form")] ??= []).push(issue.message);
  return flat;
}
