import { request } from "@playwright/test";
import { ADMIN, API_URL, E2E_PREFIXES } from "./fixtures/accounts";

/* After the suite: remove the members this run signed up (unique
   `<prefix>.<stamp>@demo.veye.test` addresses) so PostgreSQL does not fill with
   test identities and paging/counting stay stable run after run. The API
   endpoint is local-only, needs an administrator session, and never touches
   the seeded QA accounts. Failing to clean is reported, never fatal. */
export default async function globalTeardown(): Promise<void> {
  const api = await request.newContext({ baseURL: API_URL });
  try {
    const signIn = await api.post("/api/v1/auth/admin/sign-in", { data: { email: ADMIN.email, password: ADMIN.password, remember: false } });
    if (!signIn.ok()) { console.warn(`[e2e] cleanup skipped: admin sign-in answered ${signIn.status()}`); return; }
    const cleaned = await api.post("/api/v1/admin/qa/cleanup-synthetic-members", { data: { prefixes: E2E_PREFIXES } });
    if (!cleaned.ok()) { console.warn(`[e2e] cleanup skipped: ${cleaned.status()} ${await cleaned.text()}`); return; }
    const result = (await cleaned.json()) as { removed: string[]; skipped_protected: string[] };
    console.log(`[e2e] cleanup removed ${result.removed.length} synthetic member(s)${result.skipped_protected.length ? `, skipped ${result.skipped_protected.length} admin-capable` : ""}`);
    await api.post("/api/v1/auth/admin/sign-out");
  } catch (reason) {
    console.warn(`[e2e] cleanup failed: ${String(reason)}`);
  } finally {
    await api.dispose();
  }
}
