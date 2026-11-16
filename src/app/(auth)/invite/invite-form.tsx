"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FieldErrors = Record<string, string[] | undefined>;
const GENERIC = "Something went wrong. Please try again.";
const BAD_LINK = "This invite link is incomplete. Open the link from your email again.";

export function InviteForm({ signedIn }: { signedIn: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    const found = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (found && /^[0-9a-f]{64}$/.test(found)) {
      setToken(found);
      window.history.replaceState(null, "", window.location.pathname); // keep the token out of the address bar
    } else {
      setError(BAD_LINK);
    }
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = signedIn
        ? await fetch("/api/v1/invitations/accept", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ input: { token } }),
          })
        : await fetch("/api/public/invite", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token, fullName, password }),
          });
      const body = await res.json();
      if (body.ok) {
        window.location.assign(body.data.redirectTo ?? `/${body.data.institutionSlug}`);
        return;
      }
      setError(signedIn ? acceptMessage(body.error?.code) : (body.error?.message ?? GENERIC));
      setFieldErrors(body.error?.fieldErrors ?? {});
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-4" noValidate>
      {!signedIn && (
        <>
          <Field id="fullName" label="Your name" type="text" autoComplete="name" value={fullName} onChange={setFullName} errors={fieldErrors.fullName} />
          <Field id="password" label="Password (8+ characters)" type="password" autoComplete="new-password" value={password} onChange={setPassword} errors={fieldErrors.password} />
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending || !token} className="h-11 sm:h-10">
        {pending ? "Joining…" : "Join school"}
      </Button>
    </form>
  );
}

// accept_invitation errors, in words a teacher or parent can act on.
function acceptMessage(code: string | undefined): string {
  if (code === "forbidden") return "This invite was sent to a different email address. Sign in with the address it was sent to.";
  if (code === "invalid_state" || code === "not_found") return "This invite link is not valid any more. Ask your school to send a new one.";
  if (code === "conflict") return "You have already joined this school.";
  return GENERIC;
}

function Field(props: {
  id: string;
  label: string;
  type: string;
  autoComplete: string;
  value: string;
  onChange: (v: string) => void;
  errors?: string[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        name={props.id}
        type={props.type}
        required
        autoComplete={props.autoComplete}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={props.errors ? true : undefined}
        className="h-11 sm:h-10"
      />
      {props.errors && <p className="text-xs text-destructive">{props.errors.join(", ")}</p>}
    </div>
  );
}
