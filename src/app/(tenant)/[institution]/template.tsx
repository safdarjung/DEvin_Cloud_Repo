// Re-mounts on every navigation: CSS entrance (tw-animate-css) runs on paint,
// so the SSR HTML is visible without JS — no "use client" / motion needed.
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="motion-safe:animate-in motion-safe:fade-in duration-150">
      {children}
    </div>
  );
}
