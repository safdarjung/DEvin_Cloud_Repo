import { ArrowRight } from "lucide-react";

/**
 * One role = one allow-listed demo account; /api/public/demo-login re-checks the email server-side.
 * Plain HTML form with no React handlers: a click while the page is still hydrating must submit
 * natively (an onSubmit/server-action form lost early clicks).
 */
export function RoleCard({ email, role, note }: { email: string; role: string; note: string }) {
  return (
    <li>
      <form method="post" action="/api/public/demo-login">
        <input type="hidden" name="email" value={email} />
        <button
          type="submit"
          className="group flex min-h-14 w-full items-center justify-between gap-4 py-4 text-left focus-visible:outline-2 focus-visible:outline-(color:--mk-accent)"
        >
          <span>
            <span className="block font-semibold">{role}</span>
            <span className="block text-sm text-(color:--mk-muted)">{note}</span>
          </span>
          <ArrowRight className="size-4 text-(color:--mk-accent) transition-transform group-hover:translate-x-1 motion-reduce:transition-none" aria-hidden />
        </button>
      </form>
    </li>
  );
}
