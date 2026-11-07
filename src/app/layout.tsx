import type { Metadata, Viewport } from "next";
import { Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "next-themes";
import { MotionProvider } from "@/components/motion";
import { Toaster } from "@/components/ui/sonner";
import { PwaRegister } from "@/components/pwa/register";
import { JsonLd, organizationLd, websiteLd } from "@/components/seo/json-ld";
import { SITE_URL } from "@/lib/site-url";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TITLE = "Fabric — Intelligence That Moves Institutions Forward";
const DESCRIPTION =
  "Fabric is an AI-assisted operating system for private schools: admissions, attendance, fees, exams, website and communication in one permission-checked workspace.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s | Fabric" },
  description: DESCRIPTION,
  applicationName: "Fabric",
  openGraph: { type: "website", siteName: "Fabric", title: TITLE, description: DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1020" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${jakarta.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <JsonLd data={[organizationLd(SITE_URL), websiteLd(SITE_URL)]} />
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          <MotionProvider>
            {children}
            <Toaster />
            <PwaRegister />
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
