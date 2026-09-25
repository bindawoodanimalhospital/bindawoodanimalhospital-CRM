import type { Metadata, Viewport } from "next";
import { Geist_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Plus Jakarta Sans: friendly geometric sans that matches the logo wordmark and stays readable at small sizes.
const sans = Plus_Jakarta_Sans({ variable: "--font-sans", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

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
