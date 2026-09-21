// Production build for the E2E suite: the API address is inlined into the
// client bundle at build time, so it must be set here, not only at start.
import { spawnSync } from "node:child_process";

const api = process.env.E2E_API_URL ?? "http://localhost:8001";
const result = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["next", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, NEXT_PUBLIC_API_URL: api },
});
process.exit(result.status ?? 1);
