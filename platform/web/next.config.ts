import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The Docker preview is intentionally reachable on the local loopback host
  // as well as localhost; permit its development client to hydrate there.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
