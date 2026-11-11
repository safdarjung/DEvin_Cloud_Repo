"use client";

// Read-aloud toggle for one piece of AI text. Renders nothing where the
// browser has no speech synthesis. An online (vendor) voice is labelled.
import { Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSpeechOutput, type SpeechLang } from "./useSpeechOutput";

export interface SpeakButtonProps {
  text: string;
  lang?: SpeechLang;
  label?: string;
  className?: string;
}

export function SpeakButton({ text, lang, label = "Read aloud", className }: SpeakButtonProps) {
  const speech = useSpeechOutput();
  if (!speech.supported) return null;
  const on = speech.speaking || speech.paused;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Button type="button" variant="ghost" size="sm" className={className} aria-pressed={on} onClick={() => (on ? speech.stop() : speech.speak(text, lang))}>
        {on ? <Square className="fill-current" aria-hidden /> : <Volume2 aria-hidden />}
        {on ? "Stop reading" : label}
      </Button>
      {on && speech.remoteVoice && <span className="text-xs text-muted-foreground">Online voice: the text goes to your browser&apos;s maker</span>}
    </span>
  );
}
