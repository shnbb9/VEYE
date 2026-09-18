"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AuthFrame, FormError, PasswordField } from "@/components/auth/auth-frame";
import { useSession } from "@/components/session";
import { signUp, type Delivery } from "@/lib/auth-api";
import { PENDING_ANSWERS_KEY, PREFILL_EMAIL_KEY } from "@/lib/auth-keys";
import type { Answers } from "@/lib/health-number";

/* Approved sign-up (build/signup.html). The email typed at the onboarding
   result gate is pre-filled from sessionStorage and the assessment answers are
   attached to the new account so the API stores the Health Number. */

export default function SignUpPage() {
  const router = useRouter();
  const session = useSession();
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", phone: "", postal_code: "", password: "", confirm: "", remember: true });
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [destination, setDestination] = useState("/app");

  useEffect(() => {
    try {
      const prefill = sessionStorage.getItem(PREFILL_EMAIL_KEY);
      if (prefill) setForm((current) => ({ ...current, email: current.email || prefill }));
      const pending = sessionStorage.getItem(PENDING_ANSWERS_KEY);
      if (pending) setAnswers(JSON.parse(pending) as Answers);
    } catch { /* storage unavailable */ }
  }, []);

  const set = (key: keyof typeof form) => (value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!form.first_name.trim() || !form.last_name.trim()) { setError("Enter your first and last name."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(form.email.trim())) { setError("Please enter a valid email address."); return; }
    if (form.password.length < 12) { setError("Choose a password of at least 12 characters."); return; }
    if (form.password !== form.confirm) { setError("The two passwords do not match."); return; }
    setBusy(true);
    try {
      const result = await signUp({
        first_name: form.first_name.trim(), last_name: form.last_name.trim(), email: form.email.trim(), password: form.password,
        confirm_password: form.confirm, phone: form.phone.trim(), postal_code: form.postal_code.trim(), remember: form.remember,
        answers: answers ?? undefined,
      });
      try { sessionStorage.removeItem(PREFILL_EMAIL_KEY); sessionStorage.removeItem(PENDING_ANSWERS_KEY); } catch { /* ignore */ }
      await session.refresh();
      const failed = result.deliveries.filter((d) => d.status !== "sent");
      const target = result.health_number_attempt_id ? "/app" : "/onboarding";
      if (failed.length === 0) { router.replace(target); return; }
      // Email did not go out: say so before moving on rather than pretending.
      setDeliveries(result.deliveries);
      setDestination(target);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your account could not be created right now.");
    } finally { setBusy(false); }
  }

  if (deliveries) {
    return (
      <AuthFrame photo="signup">
        <div className="auth__form">
          <h1 className="auth__title">Account created</h1>
          <p className="auth__subtitle">Welcome to a healthier you!</p>
          <p className="auth__status">Your Veye account is ready and you are signed in.</p>
          {deliveries.map((d) => (
            <p key={d.kind} className={`auth__notice${d.status === "sent" ? "" : " auth__notice--warn"}`}>
              <b>{d.kind === "email_verification" ? "Verification email" : "Welcome email"}:</b> {d.status === "sent" ? "sent." : `not sent — ${d.detail ?? "the local mail service is not running"}. You can request it again from Settings.`}
            </p>
          ))}
          <Link className="btn btn--primary btn--mt" href={destination}>{destination === "/app" ? "Go to dashboard" : "Start your assessment"}</Link>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame photo="signup">
      <form className="auth__form" onSubmit={submit} noValidate>
        <h1 className="auth__title">Get Started</h1>
        <p className="auth__subtitle">Welcome to a healthier you!</p>
        {answers && <p className="auth__notice">Your Health Number from the assessment will be saved to this account.</p>}

        <div className="auth__fields auth__fields--tight">
          <div className="field"><input className="field__input" type="text" placeholder="Enter your first name" autoComplete="given-name" aria-label="First name" value={form.first_name} onChange={(e) => set("first_name")(e.target.value)} /></div>
          <div className="field"><input className="field__input" type="text" placeholder="Enter your last name" autoComplete="family-name" aria-label="Last name" value={form.last_name} onChange={(e) => set("last_name")(e.target.value)} /></div>
          <div className="field"><input className="field__input" type="email" placeholder="Enter your email" autoComplete="email" aria-label="Email" value={form.email} onChange={(e) => set("email")(e.target.value)} /></div>
          <div className="field"><input className="field__input" type="tel" placeholder="Phone number (optional)" autoComplete="tel" aria-label="Phone number (optional)" value={form.phone} onChange={(e) => set("phone")(e.target.value)} /></div>
          <div className="field"><input className="field__input" type="text" inputMode="numeric" placeholder="ZIP code (optional)" autoComplete="postal-code" aria-label="ZIP code (optional)" value={form.postal_code} onChange={(e) => set("postal_code")(e.target.value)} /></div>
          <PasswordField name="password" value={form.password} onChange={set("password") as (v: string) => void} placeholder="Enter your password" autoComplete="new-password" />
          <PasswordField name="confirm" value={form.confirm} onChange={set("confirm") as (v: string) => void} placeholder="Confirm your password" autoComplete="new-password" />
        </div>

        <div className="auth__row">
          <label className="check">
            <input type="checkbox" checked={form.remember} onChange={(e) => set("remember")(e.target.checked)} />
            <span className="check__box" />
            Remember me
          </label>
        </div>

        <p className="legal legal--terms">By signing in to Veye, you&rsquo;re agreeing to our <Link href="/terms">Terms and Conditions</Link>, and <Link href="/privacy">Privacy Policy</Link>.</p>
        <FormError message={error} />

        <button type="submit" className="btn btn--primary btn--mt" disabled={busy}>{busy ? "Creating your account…" : "Sign Up"}</button>
        <p className="auth__links">Already have an account? <Link href="/login">Sign in</Link>.</p>

        <p className="legal legal--privacy">Passwords are stored only as a modern one-way hash. This is the local development environment: accounts and emails stay on this machine.</p>
      </form>
    </AuthFrame>
  );
}
