export type PortalSearchParams = Record<string, string | string[] | undefined>;

/**
 * Redirect target for "no ?student= yet": same pathname, every existing query
 * param kept (arrays repeated), `student` set exactly once. `currentPath` is the
 * page's own server-known path, never a caller-supplied URL, so it can't be an open redirect.
 */
export function portalRedirectUrl(currentPath: string, studentId: string, searchParams: PortalSearchParams = {}): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "student" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) qs.append(key, v);
  }
  qs.set("student", studentId);
  return `${currentPath}?${qs.toString()}`;
}
