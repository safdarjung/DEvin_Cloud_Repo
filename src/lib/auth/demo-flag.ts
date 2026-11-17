// One switch for every one-click demo sign-in (login page picker, /demo cards, "Try the X demo" buttons,
// the role switcher). Off on a site with real schools: demo accounts then sign in with email and password only.
// NEXT_PUBLIC_ is inlined at build time, so this is safe in client components.
export const DEMO_QUICK_LOGIN = process.env.NEXT_PUBLIC_DEMO_LOGIN_HINTS === "true";
