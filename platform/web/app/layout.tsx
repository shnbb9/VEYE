import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { SessionProvider } from "@/components/session";

export const metadata: Metadata = {
  title: "VEYE — Nutrition Reimagined",
  description: "A practical path to better health.",
  // The prototype's favicon (build/*.html: assets/web/wp/veye-ico.svg).
  icons: { icon: "/assets/web/wp/veye-ico.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <AppShell>{children}</AppShell>
        </SessionProvider>
      </body>
    </html>
  );
}
