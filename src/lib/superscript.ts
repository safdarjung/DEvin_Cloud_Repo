// Shared by the practice quiz and the question paper print (moved from PracticeStudio.tsx).
const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", x: "ˣ", y: "ʸ",
};

/** Model text writes powers as "2x^2" or "x^{n+1}": shown as "2x²", "xⁿ⁺¹". A power with no superscript form stays as typed. */
export function withSuperscripts(text: string): string {
  return text.replace(/\^(?:\{([^{}]{1,8})\}|(-?\d+|[nixy]))/g, (whole, braced: string | undefined, bare: string | undefined) => {
    const power = (braced ?? bare ?? "").replace(/\s+/g, "");
    return [...power].every((c) => c in SUPERSCRIPT) ? [...power].map((c) => SUPERSCRIPT[c]).join("") : whole;
  });
}
