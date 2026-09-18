import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { PublicHeader } from "@/components/public-header";
import { PublicInteractions } from "@/components/public-interactions";

type PublicPage = "home" | "why" | "about" | "help" | "pricing" | "terms" | "privacy";

const sourceFile: Record<PublicPage, string> = {
  home: "index.html", why: "why-veye.html", about: "about.html", help: "help.html", pricing: "pricing.html", terms: "terms.html", privacy: "privacy.html",
};

function href(value: string) {
  return value
    .replaceAll("index.html#how-it-works", "/#how-it-works")
    .replaceAll("index.html", "/")
    .replaceAll("why-veye.html", "/why-veye")
    .replaceAll("about.html", "/about")
    .replaceAll("help.html", "/help")
    .replaceAll("pricing.html", "/pricing")
    .replaceAll("terms.html", "/terms")
    .replaceAll("privacy.html", "/privacy")
    .replaceAll("onboarding.html", "/onboarding")
    .replaceAll("login.html", "/login")
    .replaceAll("signup.html", "/signup");
}

function sourceMarkup(page: PublicPage) {
  const file = path.join(process.cwd(), "content", "public", sourceFile[page]);
  const raw = fs.readFileSync(file, "utf8");
  const body = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? "";
  // A page may carry its own <style> block in <head> (privacy.html styles its
  // typographic title there); keep it with the page markup.
  const headStyles = (raw.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "").match(/<style[\s\S]*?<\/style>/gi)?.join("\n") ?? "";
  return href(
    headStyles + body
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<div id="site-nav"><\/div>/gi, "")
      .replace(/<div id="site-footer"><\/div>/gi, "")
      .replace(/<header class="nav"[\s\S]*?<\/header>/i, "")
      .replace(/<footer class="footer"[\s\S]*?<\/footer>/i, "")
      .replace(/<!-- Announcement marquee -->[\s\S]*?<\/div>\s*<!-- Header -->/i, "")
      .replaceAll("assets/web/", "/assets/web/")
      .replaceAll('src="veye-intro.mp4"', 'src="/veye-intro.mp4"'),
  );
}

function PublicFooter() {
  return <footer className="footer"><div className="container"><div className="footer__top">
    <div className="footer__brand"><img className="footer__logo" src="/assets/web/svg/veye-logo-footer.svg" alt="Veye" /></div>
    <div className="footer__col"><ul><li><Link href="/#how-it-works">How it works</Link></li><li><Link href="/pricing">Pricing</Link></li><li><Link href="/why-veye">Why Veye</Link></li><li><span className="footer__soon" aria-disabled="true">Treatments <small>Coming soon</small></span></li><li><span className="footer__soon" aria-disabled="true">Gift Cards <small>Coming soon</small></span></li></ul></div>
    <div className="footer__col"><ul><li><Link href="/about">About</Link></li><li><Link href="/help">Resources</Link></li><li><span className="footer__soon" aria-disabled="true">Partnerships <small>Coming soon</small></span></li><li><span className="footer__soon" aria-disabled="true">Affiliates <small>Coming soon</small></span></li><li><Link href="/about">Corporate</Link></li></ul></div>
    <div className="footer__col"><ul><li><span className="footer__soon" aria-disabled="true">LinkedIn <small>Coming soon</small></span></li><li><span className="footer__soon" aria-disabled="true">Facebook <small>Coming soon</small></span></li><li><span className="footer__soon" aria-disabled="true">Instagram <small>Coming soon</small></span></li></ul></div>
    <div className="footer__connect"><p>Stay connected with health tips, specials and the latest,<br />100% natural treatments from Veye.</p><Link className="footer__signup" href="/onboarding">Sign up <span className="nav__cta-box" /></Link><p className="footer__fine">By clicking “Sign up,” you acknowledge that you have read, understood, and accepted the Privacy Policy (including sensitive data processing) and Terms of Use.</p><div className="footer__stores"><span className="footer__store" aria-disabled="true" title="Coming soon"><img src="/assets/web/svg/badge-appstore.svg" alt="App Store — coming soon" /></span><span className="footer__store" aria-disabled="true" title="Coming soon"><img src="/assets/web/svg/badge-playstore.svg" alt="Google Play — coming soon" /></span></div><p className="footer__stores-note">App Store and Google Play listings coming soon.</p></div>
  </div><hr className="footer__divider" /><p className="footer__copy">©2024 Veye LLC. All rights reserved. <Link href="/terms">Terms</Link>. <Link href="/privacy">Privacy</Link>.<br />This website is for informational purpose and should not be used as medical advice.</p></div></footer>;
}

export function PublicSourcePage({ page }: { page: PublicPage }) {
  // `site` is the prototype's own body class; its scoped rules (.site a.btn--…) must still apply.
  return <div className="public-site site">
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
    <link href="https://fonts.googleapis.com/css2?family=Jost:wght@100;200&family=Kumbh+Sans:wght@100;200;300;400;500;600;700&family=Teachers:wght@400;500;600&family=Outfit:wght@500&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/marketing-css/website.css" />
    {page !== "home" && <link rel="stylesheet" href="/marketing-css/pages.css" />}
    {page === "why" && <link rel="stylesheet" href="/marketing-css/why.css" />}
    <PublicHeader active={page} />
    <div dangerouslySetInnerHTML={{ __html: sourceMarkup(page) }} />
    <PublicFooter />
    <PublicInteractions />
  </div>;
}
