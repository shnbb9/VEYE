"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { AuthFrame, FormError, PasswordField } from "@/components/auth/auth-frame";
import { useSession } from "@/components/session";
import { forgotPassword, safeNext, signIn } from "@/lib/auth-api";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <Login />
    </Suspense>
  );
}

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const next = params.get("next");
  const flash = params.get("flash");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("veye_last_email");
      if (saved) setEmail(saved);
    } catch { /* storage unavailable */ }
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!email.trim() || !password) { setError("Enter your email address and password."); return; }
    setBusy(true);
    try {
      // MEMBER portal: whoever signs in here gets the member experience.
      // Administrator access on the account changes nothing; the admin
      // console has its own door at /admin/login.
      const { account } = await signIn(email.trim(), password, remember);
      try {
        if (remember) localStorage.setItem("veye_last_email", account.email); else localStorage.removeItem("veye_last_email");
      } catch { /* storage unavailable */ }
      await session.refresh();
      router.replace(safeNext(next, "member"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That email address and password do not match.");
    } finally { setBusy(false); }
  }

  return (
    <AuthFrame photo="login">
      <form className="auth__form" onSubmit={submit} noValidate>
        <h1 className="auth__title">My Account</h1>
        <p className="auth__subtitle">Nice to see you!</p>
        {flash === "signed-out" && <p className="auth__notice">You are signed out of your Veye account.</p>}
        {flash === "reset" && <p className="auth__notice">Your password has been changed. Sign in with your new password.</p>}
        {flash === "verified" && <p className="auth__notice">Your email address is verified. Sign in to continue.</p>}

        <div className="auth__fields">
          <div className="field">
            <input className="field__input" type="email" name="email" placeholder="Your Email" autoComplete="email" value={email}
                   onChange={(event) => setEmail(event.target.value)} aria-label="Your Email" />
          </div>
          <PasswordField name="password" value={password} onChange={setPassword} placeholder="Your Password" autoComplete="current-password" />
        </div>

        <div className="auth__row">
          <label className="check">
            <input type="checkbox" name="remember" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
            <span className="check__box" />
            Remember me
          </label>
          <button className="link link--btn" type="button" onClick={() => setResetOpen(true)}>Forgot your password?</button>
        </div>

        <p className="legal legal--terms">By signing in to Veye, you&rsquo;re agreeing to our <Link href="/terms">Terms and Conditions</Link>, and <Link href="/privacy">Privacy Policy</Link>.</p>
        <FormError message={error} />

        <button type="submit" className="btn btn--primary btn--mt" disabled={busy}>{busy ? "Signing in…" : "Login"}</button>

        <div className="divider">Don&rsquo;t have a Veye account?</div>
        <Link className="btn btn--lime" href="/onboarding">Start the process</Link>
        <p className="auth__links">Already took the assessment? <Link href="/signup">Create your account</Link>.</p>

        <p className="legal legal--privacy">This is the local development environment: accounts, sessions and emails stay on this machine. Production privacy and security will be governed by Veye&rsquo;s final Privacy Policy and technical safeguards.</p>
      </form>
      {resetOpen && <PasswordRecovery initialEmail={email} onClose={() => setResetOpen(false)} />}
    </AuthFrame>
  );
}

/* The approved recovery dialog (Functional Edits 260821). Reset by email is
   real in this environment; reset by text has no SMS provider yet and says so. */
function PasswordRecovery({ initialEmail, onClose }: { initialEmail: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<"menu" | "email" | "text" | "support" | "done">("menu");
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ message: string; note: string; warn: boolean }>({ message: "", note: "", warn: false });

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    const onCancel = (event: Event) => { event.preventDefault(); onClose(); };
    element?.addEventListener("cancel", onCancel);
    return () => element?.removeEventListener("cancel", onCancel);
  }, [onClose]);

  async function sendEmail() {
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(value)) { setError("Please enter a valid email address."); return; }
    setBusy(true); setError("");
    try {
      const result = await forgotPassword(value);
      const delivery = result.delivery;
      setDone({
        message: result.message,
        note: delivery
          ? delivery.status === "sent"
            ? "Development environment: the message was delivered to the local Mailpit mailbox (see the README for its address)."
            : `Development environment: the message could not be delivered (${delivery.detail ?? "email service unavailable"}). Start the optional mail profile and try again.`
          : "",
        warn: Boolean(delivery && delivery.status !== "sent"),
      });
      setStep("done");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The reset link could not be requested right now.");
    } finally { setBusy(false); }
  }

  return (
    <dialog className="pwd" ref={dialog} aria-labelledby="pwTitle" onClick={(event) => { if (event.target === dialog.current) onClose(); }}>
      <div className="pwd__head">
        <h2 className="pwd__title" id="pwTitle">Reset your password</h2>
        <button className="pwd__close" type="button" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>
        </button>
      </div>

      {step === "menu" && (
        <div className="pwd__step">
          <p className="pwd__sub">Choose how you&rsquo;d like to get back into your account.</p>
          <button className="pwd__opt" type="button" onClick={() => setStep("email")}>
            <b>Reset by email</b>
            <span>Veye sends a single-use password-reset link to your email address.</span>
          </button>
          <button className="pwd__opt" type="button" onClick={() => setStep("text")}>
            <b>Reset by text</b>
            <span>A one-time sign-in code by text message. Not available yet — no text-message provider is connected.</span>
          </button>
          <button className="pwd__opt" type="button" onClick={() => setStep("support")}>
            <b>Contact support</b>
            <span>Talk to the Veye team about your account.</span>
          </button>
        </div>
      )}

      {step === "email" && (
        <div className="pwd__step">
          <label className="pwd__label" htmlFor="pwEmail">Email address</label>
          <div className="field">
            <input className={`field__input${error ? " is-invalid" : ""}`} type="email" id="pwEmail" placeholder="you@example.com" autoComplete="email"
                   value={email} onChange={(event) => { setEmail(event.target.value); setError(""); }}
                   onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void sendEmail(); } }} />
          </div>
          {error && <p className="pwd__err">{error}</p>}
          <button className="btn btn--primary pwd__go" type="button" onClick={() => void sendEmail()} disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
          <button className="pwd__back" type="button" onClick={() => setStep("menu")}>Back</button>
        </div>
      )}

      {step === "text" && (
        <div className="pwd__step">
          <p className="pwd__sub">Reset by text is not available yet: Veye has no text-message provider connected in this environment. Use reset by email instead.</p>
          <button className="btn btn--primary pwd__go" type="button" onClick={() => setStep("email")}>Reset by email</button>
          <button className="pwd__back" type="button" onClick={() => setStep("menu")}>Back</button>
        </div>
      )}

      {step === "support" && (
        <div className="pwd__step">
          <p className="pwd__sub">Can&rsquo;t log in or reset your password? Contact us at help@veye.co</p>
          <a className="btn btn--primary pwd__go" href="mailto:help@veye.co">Email help@veye.co</a>
          <Link className="pwd__helplink" href="/help">Browse help &amp; FAQs instead</Link>
          <button className="pwd__back" type="button" onClick={() => setStep("menu")}>Back</button>
        </div>
      )}

      {step === "done" && (
        <div className="pwd__step">
          <p className="pwd__sub">{done.message}</p>
          {done.note && <p className={`pwd__proto${done.warn ? "" : ""}`}>{done.note}</p>}
          <button className="btn btn--primary pwd__go" type="button" onClick={onClose}>Back to sign in</button>
        </div>
      )}
    </dialog>
  );
}
