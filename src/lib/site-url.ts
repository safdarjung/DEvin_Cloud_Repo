// Canonical public origin. APP_URL in prod; localhost fallback for dev.
export const SITE_URL = (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
