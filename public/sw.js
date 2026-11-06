/* Fabric service worker. Caches ONLY public marketing shell + /offline.
 * Never caches /api, /login, /logout, /select, /portal, tenant paths, or
 * anything else. Cross-origin and non-GET requests are never touched.
 */
const VERSION = "fabric-v1";
const CACHE = `fabric-static-${VERSION}`;
const OFFLINE_URL = "/offline";

// DUPLICATE of MARKETING_SEGMENTS in src/lib/marketing/routes.ts, minus
// "select" (auth-gated) and the non-page files. Keep in sync by hand.
const MARKETING_SEGMENTS = new Set([
  "product", "modules", "ai", "security", "pricing", "how-it-works",
  "faq", "demo", "contact", "roles", "legal", "offline",
]);
const STATIC_FILES = new Set(["/manifest.webmanifest", "/llms.txt", "/for-agents.md"]);

function isMarketingPage(pathname) {
  return pathname === "/" || MARKETING_SEGMENTS.has(pathname.split("/")[1] || "");
}
function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/icon/") ||
    pathname === "/apple-icon" ||
    pathname === "/opengraph-image" ||
    STATIC_FILES.has(pathname)
  );
}

self.addEventListener("install", (event) => {
  // No skipWaiting here: the page asks for it via the SKIP_WAITING message.
  event.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE_URL)).catch(() => {}));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function put(request, response) {
  const cc = response.headers.get("cache-control") || "";
  const personal = /private|no-store/i.test(cc) || response.headers.has("set-cookie");
  if (response.ok && response.type === "basic" && !response.redirected && !personal) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    const marketing = isMarketingPage(url.pathname);
    event.respondWith(
      fetch(request)
        .then((res) => (marketing ? put(request, res) : res))
        .catch(async () => {
          if (marketing) {
            const hit = await caches.match(request);
            if (hit) return hit;
          }
          return (await caches.match(OFFLINE_URL)) || Response.error();
        }),
    );
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => put(request, res))),
    );
  }
  // everything else: default network behaviour, uncached
});
