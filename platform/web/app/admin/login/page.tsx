"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Icon } from "@/components/admin/admin-chrome";
import { useSession } from "@/components/session";
import { adminSignIn, forgotPassword, safeNext } from "@/lib/auth-api";

/* The ADMIN portal sign-in, ported from the approved admin prototype
   (admin-panel/prototype-client/js/screens/login.js): photo panel with the
   white mark and tagline, the form panel with the Veye mark, "Admin Console"
   kicker and the four-group entrance. Signing in here opens the admin
   console — always — and only for accounts with administrator access.
   Members sign in at /login; there is no admin self-registration. */

const ADMIN_CSS = ["tokens", "base", "layout", "components", "screens", "client", "motion", "responsive"];

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <AdminLogin />
    </Suspense>
  );
}

function AdminLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"sign-in" | "reset" | "reset-sent">("sign-in");
  const [resetNote, setResetNote] = useState("");
  const next = params.get("next");
  const flash = params.get("flash");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("veye_admin_last_email");
      if (saved) setEmail(saved);
    } catch { /* storage unavailable */ }
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!email.trim() || !password) { setError("Enter your email address and password."); return; }
    setBusy(true);
    try {
      const { account } = await adminSignIn(email.trim(), password, remember);
      try {
        if (remember) localStorage.setItem("veye_admin_last_email", account.email); else localStorage.removeItem("veye_admin_last_email");
      } catch { /* storage unavailable */ }
      await session.refresh();
      router.replace(safeNext(next, "admin"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That email address and password do not match.");
    } finally { setBusy(false); }
  }

  async function sendReset(event: FormEvent) {
    event.preventDefault();
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(value)) { setError("Please enter a valid email address."); return; }
    setBusy(true); setError("");
    try {
      const result = await forgotPassword(value, "admin");
      const delivery = result.delivery;
      setResetNote(delivery
        ? delivery.status === "sent"
          ? "Development environment: the message was delivered to the local Mailpit mailbox."
          : `Development environment: the message could not be delivered (${delivery.detail ?? "email service unavailable"}).`
        : "");
      setMode("reset-sent");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The reset link could not be requested right now.");
    } finally { setBusy(false); }
  }

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Kumbh+Sans:wght@300;400;500;600;700&family=Teachers:wght@400;500;600;700&display=swap" rel="stylesheet" />
      {ADMIN_CSS.map((name) => <link key={name} rel="stylesheet" href={`/admin-css/${name}.css`} />)}
      <link rel="stylesheet" href="/admin-css/admin-app.css" />

      <div className="auth" data-portal="admin">
        <section className="auth__media">
          <img className="auth__photo" src="/auth/login-people.jpg" alt="" decoding="async" fetchPriority="high" />
          <div className="auth__over">
            <img className="auth__mark" src="/auth/veye-logo-white.svg" alt="Veye" width={132} height={42} decoding="async" />
            <p className="auth__tag">Nutrition Reimagined</p>
            <p className="auth__sub">The console behind the Veye member experience — assessments, plans, content and the people using them.</p>
          </div>
        </section>

        <section className="auth__panel">
          {mode === "sign-in" && (
            <form className="auth__form auth-seq" id="signin" onSubmit={submit} noValidate>
              <div className="auth__brand auth-seq__step" style={{ "--i": 0 } as React.CSSProperties}>
                <img src="/admin/veye-logo.png" alt="Veye" width={96} height={30} decoding="async" />
                <span className="auth__kicker">Admin Console</span>
              </div>

              <div className="auth-seq__step" style={{ "--i": 1 } as React.CSSProperties}>
                <h1>Sign in</h1>
                <p className="auth__lede">Welcome back. Use the email address your invitation was sent to.</p>
                {flash === "reset" && <p className="notice notice--quiet" style={{ marginTop: 12 }}>Your password has been changed. Sign in with your new password.</p>}
                {flash === "signed-out" && <p className="notice notice--quiet" style={{ marginTop: 12 }}>You are signed out of the admin console.</p>}
              </div>

              <div className="auth__fields auth-seq__step" style={{ "--i": 2 } as React.CSSProperties}>
                <div className="field">
                  <label htmlFor="admin-email">Email address <span className="t-muted">(required)</span></label>
                  <input className="input" id="admin-email" name="email" type="email" autoComplete="username" required placeholder="you@veye.example"
                         value={email} onChange={(event) => setEmail(event.target.value)} />
                </div>
                <div className="field field--pw">
                  <label htmlFor="admin-password">Password <span className="t-muted">(required)</span></label>
                  <input className="input" id="admin-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required
                         placeholder="Your password" value={password} onChange={(event) => setPassword(event.target.value)} />
                  <button className="field__reveal" type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}
                          onClick={() => setShowPassword((value) => !value)}><Icon name="eye" size={18} /></button>
                </div>
              </div>

              <div className="auth__row auth-seq__step" style={{ "--i": 3 } as React.CSSProperties}>
                <label className="check">
                  <input type="checkbox" id="admin-remember" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                  <span className="check__text">Remember me</span>
                </label>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setError(""); setMode("reset"); }}>Forgot password?</button>
              </div>

              {error && <p className="field__error" role="alert">{error}</p>}

              <button className="btn btn--primary btn--lg btn--block auth__submit auth-seq__step" style={{ "--i": 3 } as React.CSSProperties} type="submit" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </button>

              <p className="auth__legal auth-seq__step" style={{ "--i": 3 } as React.CSSProperties}>
                By signing in you agree to the Veye <Link className="linkbtn" href="/terms">Terms and Conditions</Link> and <Link className="linkbtn" href="/privacy">Privacy Policy</Link>.
                Members sign in to the Veye application at <Link className="linkbtn" href="/login">/login</Link>.
              </p>
            </form>
          )}

          {mode === "reset" && (
            <form className="auth__form" onSubmit={sendReset} noValidate>
              <div className="auth__brand">
                <img src="/admin/veye-logo.png" alt="Veye" width={96} height={30} decoding="async" />
                <span className="auth__kicker">Admin Console</span>
              </div>
              <h1>Reset your password</h1>
              <p className="auth__lede">We will email a single-use link that lets you set a new password. It expires after 30 minutes.</p>
              <div className="auth__fields">
                <div className="field">
                  <label htmlFor="admin-reset-email">Email address <span className="t-muted">(required)</span></label>
                  <input className="input" id="admin-reset-email" type="email" autoComplete="username" required placeholder="you@veye.example"
                         value={email} onChange={(event) => setEmail(event.target.value)} />
                </div>
              </div>
              {error && <p className="field__error" role="alert">{error}</p>}
              <button className="btn btn--primary btn--lg btn--block auth__submit" type="submit" disabled={busy}>{busy ? "Sending…" : "Send the reset link"}</button>
              <button className="btn btn--ghost btn--block" type="button" style={{ marginTop: 10 }} onClick={() => { setError(""); setMode("sign-in"); }}>Back to sign in</button>
            </form>
          )}

          {mode === "reset-sent" && (
            <div className="auth__form">
              <div className="auth__brand">
                <img src="/admin/veye-logo.png" alt="Veye" width={96} height={30} decoding="async" />
                <span className="auth__kicker">Admin Console</span>
              </div>
              <h1>Check your email</h1>
              <p className="auth__lede">If an account exists for that address, a password-reset link has been sent.</p>
              {resetNote && <p className="t-support" style={{ marginTop: 12 }}>{resetNote}</p>}
              <button className="btn btn--primary btn--lg btn--block auth__submit" type="button" onClick={() => setMode("sign-in")}>Back to sign in</button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
