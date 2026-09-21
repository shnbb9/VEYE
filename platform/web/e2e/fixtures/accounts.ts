/* Synthetic LOCAL QA accounts — created by the API seed (app/seed/users.py).
   They exist only on a developer's machine; nothing here is a real credential. */

export const ADMIN = { email: "cara.hogue@demo.veye.test", password: "CaraAdmin!2026-local", firstName: "Cara" };
/** A second administrator-only identity with the SAME plain capability (no roles). */
export const ADMIN_TWO = { email: "priya.ops@demo.veye.test", password: "PriyaOps!2026-local", firstName: "Priya" };
export const ADITYA = { email: "aditya.demo@demo.veye.test", password: "AdityaDemo!2026-local", firstName: "Aditya" };
export const MAYA = { email: "maya.demo@demo.veye.test", password: "MayaDemo!2026-local", firstName: "Maya" };
/** Member profile AND administrator access on one account. */
export const DUAL = { email: "jordan.dual@demo.veye.test", password: "JordanDual!2026-local", firstName: "Jordan" };

export const API_URL = process.env.E2E_API_URL ?? "http://localhost:8001";
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? "http://localhost:8026";

/** Prefixes the suite signs members up with; the global teardown removes exactly these. */
export const E2E_PREFIXES = ["e2e", "signup", "guided", "journey", "iso", "photo", "probe", "reset", "trackers", "gone"];

/** A unique member address per run, so sign-up tests never collide. */
export function freshMember(prefix = "e2e") {
  if (!E2E_PREFIXES.includes(prefix)) throw new Error(`Add "${prefix}" to E2E_PREFIXES so the teardown can clean it up.`);
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { email: `${prefix}.${stamp}@demo.veye.test`, password: `E2E-Member!${stamp}-2026`, firstName: "Ember", lastName: `Test${stamp.slice(-3)}` };
}
