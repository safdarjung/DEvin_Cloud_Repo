import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline", robots: { index: false, follow: false } };

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-semibold">You are offline</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Fabric needs a connection for signed-in pages. Reconnect and try again. Previously visited public pages may still open.
      </p>
    </main>
  );
}
