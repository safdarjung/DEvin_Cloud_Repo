"use client";

import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

// Registers /sw.js in production only. A new worker waits until the user
// accepts the "Update available" toast (sends SKIP_WAITING), then we reload.
export function PwaRegister() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    let reloading = false;

    const onController = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    const promptUpdate = (worker: ServiceWorker) =>
      toast("Update available", {
        duration: Infinity,
        action: { label: "Refresh", onClick: () => worker.postMessage({ type: "SKIP_WAITING" }) },
      });

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        if (cancelled) return;
        // Only prompt when a previous worker already controls the page (an update, not first install).
        if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const w = reg.installing;
          w?.addEventListener("statechange", () => {
            if (w.state === "installed" && navigator.serviceWorker.controller) promptUpdate(w);
          });
        });
      })
      .catch(() => {});

    navigator.serviceWorker.addEventListener("controllerchange", onController);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onController);
    };
  }, []);

  if (online) return null;
  return (
    <div
      role="status"
      className="fixed bottom-3 left-3 z-50 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground shadow-sm"
    >
      Offline
    </div>
  );
}
