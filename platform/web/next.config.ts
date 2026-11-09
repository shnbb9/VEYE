import type { NextConfig } from "next";

/* Security headers for the pages themselves. The API sets its own on every
   JSON answer; these cover the HTML a browser actually renders.

   What this buys, plainly:
     * frame-ancestors / X-Frame-Options — the console and the member
       application cannot be framed, so no clickjacking of a signed-in page;
     * object-src none, base-uri self, form-action self — a reflected tag
       cannot load a plugin, move the base URL, or post the session somewhere;
     * no-referrer — a reset or invitation token in a URL never leaks to a
       third party through the Referer header.

   What it does NOT yet buy: script-src still allows inline scripts, because
   Next.js injects its hydration payload inline and locking that down needs
   per-request nonces (middleware). Until that is done this CSP is a real but
   partial defence, and it is better to say so than to let the header imply
   protection against injected script that is not there. */

const api = process.env.NEXT_PUBLIC_API_URL ?? "";
const connect = ["'self'", api].filter(Boolean).join(" ");

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // Member photos and console avatars come from the API origin; the approved
  // prototype also uses data: URIs for small inline artwork.
  `img-src 'self' data: blob: ${api}`.trim(),
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // The Fitness screens embed the client's approved YouTube videos.
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com",
  "media-src 'self'",
  `connect-src ${connect}`,
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /* The Docker web service bind-mounts ./web, so its `next dev` writes into
     the same .next as a build started on the host. A host build then reads
     type files the container is still writing and fails on a half-written
     one. The acceptance suite therefore builds into its own directory and
     leaves the running 3012 development server entirely alone — the same rule
     that keeps it off port 3012. */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The Docker preview is intentionally reachable on the local loopback host
  // as well as localhost; permit its development client to hydrate there.
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
