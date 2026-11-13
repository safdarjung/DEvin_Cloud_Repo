// Exam runner clock origin (Phase 4): when the server read serverNow, on the monotonic performance clock.
// One hard page load per document: only the first runner mount on the URL the document was loaded for may use its timing.
let documentTimingUsed = false;

export function markDocumentTimingUsed(): void {
  documentTimingUsed = true;
}

/**
 * performance.now() of the moment serverNow was read (approximately): the document's responseStart when this
 * runner came with a hard load or reload (hydration can be seconds later), else now (a client navigation
 * renders as its payload arrives). responseStart can only be early, so the clock errs toward less time.
 */
export function responseAt(): number {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const sameDoc = !!nav && new URL(nav.name).pathname === window.location.pathname;
  return sameDoc && !documentTimingUsed && nav.responseStart > 0 ? nav.responseStart : performance.now();
}
