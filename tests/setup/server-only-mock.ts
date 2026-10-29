// `server-only`'s real module unconditionally throws unless the bundler sets
// the `react-server` resolve condition (Next.js does this; Vitest doesn't).
// Alias it to this no-op so tests can import server-only modules directly.
export {};
