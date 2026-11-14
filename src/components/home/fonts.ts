import { Bricolage_Grotesque } from "next/font/google";

/** Display face of the landing page and the deck; body text stays on the app's Plus Jakarta Sans. */
export const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "800"],
  display: "swap",
});
