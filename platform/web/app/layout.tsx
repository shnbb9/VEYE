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
        {/* Without JavaScript most of this application renders nothing at all.
            Both sign-in screens, the invitation and password-reset screens, the
            two verification screens and the whole 12-question assessment read
            the query string, which puts them behind a
            `<Suspense fallback={null}>`; the prerendered HTML for each is the
            shell and the script tags, 6.6KB to 9.3KB with no form in it. A
            visitor whose bundle is blocked or fails to arrive was shown the
            browser's tab title and a blank page, with no way to tell a broken
            site from a broken connection. This says which it is — and it is
            also what explains the sign-in button that now, correctly, POSTs and
            re-renders rather than putting a password in the URL.

            Worded for every page, because it sits above all of them: the
            marketing pages are readable without JavaScript; the application is
            not. */}
        <noscript>
          <div className="noscript-note">
            <strong>Veye needs JavaScript for most of what it does.</strong>
            <span>If this page is empty, or a button does nothing, turn JavaScript on for this site and reload.</span>
          </div>
        </noscript>
        <SessionProvider>
          <AppShell>{children}</AppShell>
        </SessionProvider>
      </body>
    </html>
  );
}
