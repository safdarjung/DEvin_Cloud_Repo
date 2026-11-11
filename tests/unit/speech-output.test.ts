import { describe, expect, it } from "vitest";
import { chunkText, detectLang, pickVoice, stripMarkdown } from "@/modules/ai/components/voice/useSpeechOutput";

describe("stripMarkdown", () => {
  it("drops markdown syntax and ends each line with a pause", () => {
    const md = "## Heart\n- **Atria** receive blood\n- [Ventricles](https://x.y) pump it\n\n```js\ncode()\n```\nUse `ECG` to check";
    expect(stripMarkdown(md)).toBe("Heart. Atria receive blood. Ventricles pump it. Use ECG to check.");
  });

  it("reads table rows as comma lists and skips the rule line", () => {
    expect(stripMarkdown("| Part | Role |\n|---|---|\n| Motor | Spins |")).toBe("Part, Role. Motor, Spins.");
  });
});

describe("chunkText", () => {
  it("keeps sentences whole and chunks under the limit", () => {
    const text = "One two three. Four five six! Seven eight nine? Ten.";
    const chunks = chunkText(text, 30);
    expect(chunks).toEqual(["One two three. Four five six!", "Seven eight nine? Ten."]);
  });

  it("does not split a decimal and splits a very long sentence at spaces", () => {
    expect(chunkText("It is 3.5 litres.", 100)).toEqual(["It is 3.5 litres."]);
    const long = Array.from({ length: 60 }, () => "word").join(" ");
    const chunks = chunkText(long, 50);
    expect(chunks.every((c) => c.length <= 50)).toBe(true);
    expect(chunks.join(" ")).toBe(long);
  });

  it("splits Hindi at the danda", () => {
    expect(chunkText("दिल धड़कता है। खून बहता है।", 15)).toEqual(["दिल धड़कता है।", "खून बहता है।"]);
  });
});

describe("pickVoice and detectLang", () => {
  const voices = [
    { name: "US", lang: "en-US", localService: true },
    { name: "Google IN", lang: "en-IN", localService: false },
    { name: "Heera", lang: "en_IN", localService: true },
    { name: "Google Hindi", lang: "hi-IN", localService: false },
  ];

  it("prefers an on-device voice in the exact language", () => {
    expect(pickVoice(voices, "en-IN")?.name).toBe("Heera");
  });

  it("falls back to an online voice in the exact language, then the base language", () => {
    expect(pickVoice(voices, "hi-IN")?.name).toBe("Google Hindi");
    expect(pickVoice(voices.slice(0, 1), "en-IN")?.name).toBe("US");
    expect(pickVoice(voices.slice(0, 1), "hi-IN")).toBeNull();
  });

  it("detects Devanagari as Hindi", () => {
    expect(detectLang("दिल")).toBe("hi-IN");
    expect(detectLang("heart")).toBe("en-IN");
  });
});
