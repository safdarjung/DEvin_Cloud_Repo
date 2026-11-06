import Link from "next/link";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-screen w-full max-w-xl place-items-center px-4">
      <EmptyState
        title="Page not found"
        description="That page doesn't exist or you may not have access to it."
        action={
          <Button asChild className="mt-2">
            <Link href="/">Go to home</Link>
          </Button>
        }
      />
    </main>
  );
}
