// Production build for the E2E suite: the API address is inlined into the
// client bundle at build time, so it must be set here, not only at start.
import { spawnSync } from "node:child_process";

const api = process.env.E2E_API_URL ?? "http://localhost:8001";
// Built into its own directory (next.config.ts reads NEXT_DIST_DIR): the
// Docker development server shares ./web and keeps writing .next, and a build
// that reads its half-written type files fails for no reason of its own.
const distDir = process.env.NEXT_DIST_DIR ?? ".next-e2e";
const result = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, NEXT_PUBLIC_API_URL: api, NEXT_DIST_DIR: distDir },
});
process.exit(result.status ?? 1);
