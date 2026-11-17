import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Plus Jakarta Sans: friendly geometric sans that matches the logo wordmark and stays readable at small sizes.
// Font files ship with the app (./fonts, SIL Open Font License) so it never needs the internet to fetch them.
const sans = localFont({ src: "./fonts/plus-jakarta-sans.woff2", variable: "--font-sans", weight: "200 800", display: "swap" });
const geistMono = localFont({ src: "./fonts/geist-mono.woff2", variable: "--font-geist-mono", weight: "100 900", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Bin Dawood Animal Hospital", template: "%s · Bin Dawood Animal Hospital" },
  description: "Practice management & CRM for Bin Dawood Animal Hospital, Lahore",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#7a1f30" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
