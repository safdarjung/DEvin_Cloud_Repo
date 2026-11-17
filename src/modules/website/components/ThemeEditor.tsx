"use client";

// The public site's look: colours, fonts, corner radius and hero style, with a
// live sample page and a WCAG contrast warning. "Suggest a look with AI" fills
// the form only (rule 6); nothing changes until Save (website.theme.save).
import { useActionState, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ActionResult } from "@/lib/actions/result";
import { AiDraftBadge } from "@/modules/ai/components/AiDraft";
import { postAiTask, type AiProviderMeta } from "@/modules/ai/components/ai-task-fetch";
import { saveWebsiteTheme } from "@/modules/website/actions";
import { websiteTemplate } from "@/modules/website/templates";
import {
  DEFAULT_WEBSITE_THEME,
  HERO_STYLES,
  THEME_FONTS,
  THEME_RADII,
  themeContrastIssues,
  type WebsiteTheme,
} from "@/modules/website/theme";
import { LivePreview } from "./LivePreview";

const COLOURS = [
  { key: "primary", label: "Primary (buttons, links)" },
  { key: "accent", label: "Accent (decorative bars)" },
  { key: "background", label: "Background" },
  { key: "foreground", label: "Text" },
] as const;

const HERO_LABELS: Record<WebsiteTheme["heroStyle"], string> = {
  split: "Split: text beside image",
  centered: "Centred text",
  banner: "Banner in the primary colour",
};

interface ThemeEditorProps {
  institutionSlug: string;
  institutionName: string;
  initialTheme: WebsiteTheme;
  /** AI on for this school and role (aiTaskOn website_theme_draft). */
  aiOn: boolean;
}

export function ThemeEditor({ institutionSlug, institutionName, initialTheme, aiOn }: ThemeEditorProps) {
  const id = useId();
  const [theme, setTheme] = useState<WebsiteTheme>(initialTheme);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiProvider, setAiProvider] = useState<AiProviderMeta["provider"] | null>(null);
  // The template's "[number]" values are fill-in prompts for a real page; a style preview should read as finished.
  const SAMPLE_STAT: Record<string, string> = { Students: "1,200", Teachers: "60", "Years of teaching": "25", Board: "CBSE" };
  const sample = websiteTemplate("home", institutionName).map((b) =>
    b.type === "stats" ? { ...b, items: b.items.map((i) => (i.value.startsWith("[") ? { ...i, value: SAMPLE_STAT[i.label] ?? "—" } : i)) } : b,
  );

  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    () => saveWebsiteTheme(institutionSlug, theme),
    null,
  );

  const issues = themeContrastIssues(theme);
  const set = <K extends keyof WebsiteTheme>(key: K, value: WebsiteTheme[K]) => setTheme((t) => ({ ...t, [key]: value }));

  async function suggest() {
    setBusy(true);
    setAiError(null);
    const res = await postAiTask<{ theme: WebsiteTheme } & AiProviderMeta>("/api/ai/website-theme", { institutionSlug, brief });
    setBusy(false);
    if (!res.ok) return setAiError(res.message);
    setTheme(res.data.theme);
    setAiProvider(res.data.provider);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="min-w-0 space-y-5">
        {aiOn && (
          <div className="space-y-2 rounded-lg border border-dashed p-4">
            <label htmlFor={`${id}-brief`} className="block text-sm font-medium">
              Suggest a look with AI
            </label>
            <div className="flex flex-wrap gap-2">
              <Input
                id={`${id}-brief`}
                className="min-w-56 flex-1"
                maxLength={500}
                placeholder="e.g. warm, traditional, navy and gold"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
              />
              <Button type="button" variant="outline" disabled={busy || !brief.trim()} onClick={suggest}>
                {busy ? "Suggesting…" : "Suggest"}
              </Button>
            </div>
            {aiError && (
              <p role="alert" className="text-sm text-destructive">
                {aiError}
              </p>
            )}
            {aiProvider && <AiDraftBadge provider={aiProvider} text="AI suggestion in the form below, not saved yet" />}
          </div>
        )}

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">Colours</legend>
          {COLOURS.map((c) => (
            <label key={c.key} className="flex items-center gap-3 rounded-md border p-2 text-sm">
              <input
                type="color"
                className="h-9 w-12 shrink-0 cursor-pointer rounded border bg-transparent"
                value={theme[c.key].toLowerCase()}
                onChange={(e) => set(c.key, e.target.value)}
              />
              <span className="min-w-0">
                <span className="block">{c.label}</span>
                <span className="font-mono text-xs text-muted-foreground">{theme[c.key]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {issues.length > 0 && (
          <div role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {issues.map((issue) => (
              <p key={issue.pair}>{issue.message}</p>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <ThemeSelect
            label="Heading font"
            value={theme.headingFont}
            options={Object.entries(THEME_FONTS).map(([value, f]) => ({ value, label: f.label }))}
            onChange={(v) => set("headingFont", v as WebsiteTheme["headingFont"])}
          />
          <ThemeSelect
            label="Body font"
            value={theme.bodyFont}
            options={Object.entries(THEME_FONTS).map(([value, f]) => ({ value, label: f.label }))}
            onChange={(v) => set("bodyFont", v as WebsiteTheme["bodyFont"])}
          />
          <ThemeSelect
            label="Corners"
            value={theme.radius}
            options={Object.keys(THEME_RADII).map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))}
            onChange={(v) => set("radius", v as WebsiteTheme["radius"])}
          />
          <ThemeSelect
            label="Hero style"
            value={theme.heroStyle}
            options={HERO_STYLES.map((value) => ({ value, label: HERO_LABELS[value] }))}
            onChange={(v) => set("heroStyle", v as WebsiteTheme["heroStyle"])}
          />
        </div>

        <form action={formAction} className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save look"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setTheme(DEFAULT_WEBSITE_THEME)}>
            Reset to default
          </Button>
          {state && !state.ok && (
            <span role="alert" className="text-sm text-destructive">
              {state.error.message}
            </span>
          )}
          {state?.ok && (
            <span role="status" className="text-sm text-muted-foreground">
              Saved. The public site now uses this look.
            </span>
          )}
        </form>
      </div>

      <div className="min-w-0 space-y-2 xl:self-start">
        <Badge variant="outline">Sample home page with this look</Badge>
        <LivePreview blocks={sample} theme={theme} />
      </div>
    </div>
  );
}

function ThemeSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
