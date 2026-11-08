// Re-mounts on every navigation: CSS entrance (tw-animate-css) runs on paint,
// so the SSR HTML is visible without JS — no "use client" / motion needed.
// 200ms (--duration-normal) opacity + 4px rise, transform-only (no layout
// shift); zeroed under prefers-reduced-motion via motion-safe + the tokens.
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="ease-(--ease-out) motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-(--duration-normal)">
      {children}
    </div>
  );
}
