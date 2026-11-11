"use client";

// F18 §H step 2: logo (uploaded with the caller's own client to the public
// `school-branding` bucket at <institution_id>/logo.<ext>; storage policies let
// only an active owner/principal/admin write it, 0127) + primary colour →
// core.setup.saveBranding. File names are shown as text only.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { createClient } from "@/lib/supabase/client";
import { formatBytes } from "@/modules/documents/upload-check";
import { saveBranding, setProgress } from "@/modules/core/setup/actions";
import {
  contrastRatio,
  isHexColour,
  isLogoMime,
  LOGO_BUCKET,
  logoPathFor,
  MAX_LOGO_BYTES,
  MIN_CONTRAST,
} from "@/modules/core/setup/branding-utils";
import type { SetupStepState } from "@/modules/core/setup/queries";

interface StepBrandingProps {
  institutionSlug: string;
  institutionId: string;
  state: SetupStepState;
  logoPath: string | null;
  primaryColor: string | null;
}

export function StepBranding({ institutionSlug, institutionId, state, logoPath, primaryColor }: StepBrandingProps) {
  const router = useRouter();
  const [color, setColor] = useState(primaryColor ?? "#1d4ed8");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const colorOk = isHexColour(color);
  const ratio = colorOk ? contrastRatio(color, "#ffffff") : null;

  function pickFile(next: File | null) {
    setError(null);
    if (next && !isLogoMime(next.type)) {
      setFile(null);
      return setError("Logo must be a PNG, JPEG or WebP image.");
    }
    if (next && next.size > MAX_LOGO_BYTES) {
      setFile(null);
      return setError(`Logo is larger than ${formatBytes(MAX_LOGO_BYTES)}.`);
    }
    setFile(next);
  }

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      let uploadedPath: string | undefined;
      if (file && isLogoMime(file.type)) {
        const path = logoPathFor(institutionId, file.type);
        // Same path on replace, so a short cache keeps the new logo from hiding behind the old one.
        const up = await createClient().storage.from(LOGO_BUCKET).upload(path, file, { upsert: true, contentType: file.type, cacheControl: "300" });
        if (up.error) return setError("The logo could not be uploaded. Try again.");
        uploadedPath = path;
      }
      if (!uploadedPath && !colorOk) return setError("Choose a logo or enter a valid colour.");
      const result = await saveBranding(institutionSlug, {
        ...(uploadedPath ? { logoPath: uploadedPath } : {}),
        ...(colorOk ? { primaryColor: color } : {}),
      });
      if (!result.ok) return setError(describeActionError(result.error));
      const mark = await setProgress(institutionSlug, { step: "branding", state: "done" });
      if (!mark.ok) return setError(describeActionError(mark.error));
      setSaved(true);
      setFile(null);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function skip() {
    setPending(true);
    const result = await setProgress(institutionSlug, { step: "branding", state: state === "dismissed" ? "todo" : "dismissed" });
    setPending(false);
    if (!result.ok) return setError(describeActionError(result.error));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {logoPath && <p className="text-sm text-muted-foreground">A logo is set. Upload another to replace it.</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="branding-logo">Logo (PNG, JPEG or WebP, up to {formatBytes(MAX_LOGO_BYTES)})</Label>
          <Input id="branding-logo" type="file" accept="image/png,image/jpeg,image/webp" disabled={pending} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          {file && <p className="text-xs text-muted-foreground">Selected: {file.name}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="branding-color">Primary colour (#rrggbb)</Label>
          <div className="flex items-center gap-2">
            <Input id="branding-color" value={color} maxLength={7} onChange={(e) => setColor(e.target.value.trim())} aria-invalid={!colorOk} aria-describedby="branding-color-note" disabled={pending} />
            <span
              aria-hidden
              className="size-9 shrink-0 rounded-md border border-border"
              style={colorOk ? { backgroundColor: color } : undefined}
              data-testid="branding-swatch"
            />
          </div>
          <p id="branding-color-note" className={`text-xs ${colorOk ? "text-muted-foreground" : "text-destructive"}`}>
            {!colorOk
              ? "Enter a colour like #1d4ed8."
              : ratio !== null && ratio < MIN_CONTRAST
                ? `Low contrast: white text on this colour is ${ratio.toFixed(1)}:1, below the ${MIN_CONTRAST}:1 minimum. Dark text will be used on it.`
                : `Contrast with white text is ${ratio?.toFixed(1)}:1, which is fine.`}
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-muted-foreground">
          Branding saved.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={pending || (!file && !colorOk)}>
          {pending ? "Saving…" : "Save branding"}
        </Button>
        <Button variant="ghost" onClick={skip} disabled={pending}>
          {state === "dismissed" ? "Resume this step" : "Skip for now"}
        </Button>
      </div>
    </div>
  );
}
