"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FieldErrors = Record<string, string[] | undefined>;

const FIELDS = [
  { name: "code", label: "Invite code", type: "text", autoComplete: "off", placeholder: "XXXX-XXXX-…" },
  { name: "schoolName", label: "School name", type: "text", autoComplete: "organization", placeholder: "Green Valley Public School" },
  { name: "slug", label: "Web address", type: "text", autoComplete: "off", placeholder: "green-valley" },
  { name: "ownerName", label: "Your name", type: "text", autoComplete: "name", placeholder: "Asha Rao" },
  { name: "email", label: "Your email", type: "email", autoComplete: "email", placeholder: "you@school.in" },
  { name: "password", label: "Password (8+ characters)", type: "password", autoComplete: "new-password", placeholder: "" },
] as const;

type FieldName = (typeof FIELDS)[number]["name"];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

export function StartForm({ initialCode = "", initialEmail = "" }: { initialCode?: string; initialEmail?: string }) {
  const [values, setValues] = useState<Record<FieldName, string>>({
    code: initialCode,
    schoolName: "",
    slug: "",
    ownerName: "",
    email: initialEmail,
    password: "",
  });
  const [slugEdited, setSlugEdited] = useState(false);
  const [editingSlug, setEditingSlug] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function update(name: FieldName, value: string) {
    setValues((prev) => ({
      ...prev,
      [name]: value,
      ...(name === "schoolName" && !slugEdited ? { slug: slugify(value) } : {}),
    }));
    if (name === "slug") setSlugEdited(true);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch("/api/public/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await res.json();
      if (body.ok) {
        window.location.assign(body.data.redirectTo);
        return;
      }
      setError(body.error?.message ?? "Something went wrong. Please try again.");
      setFieldErrors(body.error?.fieldErrors ?? {});
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-4" noValidate>
      {FIELDS.map((field) => {
        const errors = fieldErrors[field.name];
        // The web address follows the school name; it is only shown as an input when changed or in error.
        if (field.name === "slug" && !editingSlug && !errors) return null;
        return (
          <div key={field.name} className="flex flex-col gap-1.5">
            <Label htmlFor={field.name}>{field.label}</Label>
            <Input
              id={field.name}
              name={field.name}
              type={field.type}
              required
              autoComplete={field.autoComplete}
              placeholder={field.placeholder}
              value={values[field.name]}
              onChange={(e) => update(field.name, e.target.value)}
              aria-invalid={errors ? true : undefined}
              aria-describedby={errors ? `${field.name}-error` : undefined}
              className="h-11 sm:h-10"
            />
            {field.name === "slug" && values.slug && (
              <p className="text-xs text-muted-foreground">Your school will live at /{values.slug}</p>
            )}
            {field.name === "schoolName" && !editingSlug && values.slug && !fieldErrors.slug && (
              <p className="text-xs text-muted-foreground">
                Web address: /{values.slug}{" "}
                <button type="button" className="underline underline-offset-2" onClick={() => setEditingSlug(true)}>
                  Change
                </button>
              </p>
            )}
            {errors && (
              <p id={`${field.name}-error`} className="text-xs text-destructive">
                {errors.join(", ")}
              </p>
            )}
          </div>
        );
      })}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="h-11 sm:h-10">
        {pending ? "Creating your school…" : "Create school"}
      </Button>
    </form>
  );
}
