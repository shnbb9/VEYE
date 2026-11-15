"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { AuthFrame, FormError, PasswordField } from "@/components/auth/auth-frame";
import { useSession } from "@/components/session";
import { forgotPassword, safeNext, sessionNotKept, signIn, type SessionNotKept } from "@/lib/auth-api";

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
  const [errorLink, setErrorLink] = useState<SessionNotKept["link"]>(null);
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const next = params.get("next");
  const flash = params.get("flash");

  useEffect(() => {
    try {
      // After an email change the remembered address is precisely the one that
      // has stopped working, so it is cleared rather than offered back.
      if (flash === "email-changed") { localStorage.removeItem("veye_last_email"); return; }
      const saved = localStorage.getItem("veye_last_email");
      if (saved) setEmail(saved);
    } catch { /* storage unavailable */ }
  }, [flash]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setErrorLink(null);
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
      const current = await session.refresh();
      if (!current.member) {
        // Accepted, but the cookie did not stay: moving on would only bring
        // the member area's guard straight back here.
        const why = sessionNotKept("member", "Your password was accepted");
        setError(why.message);
        setErrorLink(why.link);
        return;
      }
      router.replace(safeNext(next, "member"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That email address and password do not match.");
    } finally { setBusy(false); }
  }

  return (
    <AuthFrame photo="login">
      {/* method="post" is not for the handler — which preventDefaults — but for
          the submit that happens BEFORE it is attached. A form with no method
          submits as a GET, and this one put the member's email and password in
          the query string, the address bar and the browser's history. */}
      <form className="auth__form" method="post" onSubmit={submit} noValidate>
        <h1 className="auth__title">My Account</h1>
        <p className="auth__subtitle">Nice to see you!</p>
        {flash === "signed-out" && <p className="auth__notice">You are signed out of your Veye account.</p>}
        {flash === "reset" && <p className="auth__notice">Your password has been changed. Sign in with your new password.</p>}
        {flash === "verified" && <p className="auth__notice">Your email address is verified. Sign in to continue.</p>}
        {flash === "email-changed" && <p className="auth__notice">Your email address has been changed. Sign in with the new address and the password you already had.</p>}

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
        <FormError message={error} link={errorLink} />

        <button type="submit" className="btn btn--primary btn--mt" disabled={busy}>{busy ? "Signing in…" : "Login"}</button>

        <div className="divider">Don&rsquo;t have a Veye account?</div>
        <Link className="btn btn--lime" href="/onboarding">Start the process</Link>

        {/* The prototype's small print (build/login.html) without its first
            sentence, "In this prototype, your demo information stays in this
            browser", which is not true of real accounts (owner decision,
            14 Nov 2026). */}
        <p className="legal legal--privacy">Production privacy and security will be governed by Veye&rsquo;s final Privacy Policy and technical safeguards.</p>
      </form>
      {resetOpen && <PasswordRecovery initialEmail={email} onClose={() => setResetOpen(false)} />}
    </AuthFrame>
  );
}

/* The approved recovery dialog (Functional Edits 260821). Reset by email is
   real in this environment; reset by text has no SMS provider yet and says so. */
function PasswordRecovery({ initialEmail, onClose }: { initialEmail: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  type Step = "menu" | "email" | "text" | "support" | "done";
  const [step, setStepState] = useState<Step>("menu");
  // Each step opens with its first control focused, as the prototype's show()
  // does (build/js/auth.js). Only a person's own step change asks for it: the
  // counter is 0 at mount, so the first menu is left to showModal() (which
  // focuses the close button, as in the prototype) — StrictMode's doubled
  // mount effects included.
  const [focusTick, setFocusTick] = useState(0);
  const setStep = (next: Step) => { setStepState(next); setFocusTick((tick) => tick + 1); };
  useEffect(() => {
    if (focusTick === 0) return;
    dialog.current?.querySelector<HTMLElement>(".pwd__step button, .pwd__step input, .pwd__step a")?.focus();
  }, [focusTick]);
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ message: string; note: string; warn: boolean }>({ message: "", note: "", warn: false });
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");

  function sendText() {
    if (phone.replace(/[^0-9]/g, "").length < 7) { setPhoneError("Please enter a phone number."); return; }
    setDone({ message: `Texting a sign-in code to ${phone.trim()} is not available yet, so nothing was sent. Please reset by email instead.`, note: "", warn: false });
    setStep("done");
  }

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
        // The prototype's sentence ("a reset link would now be emailed to
        // <address>"), made true: a link goes only to an address that has an
        // account, and the screen must not reveal which addresses do.
        message: `A reset link has now been emailed to ${value}, if it belongs to a Veye account.`,
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
            <span>Veye sends a password-reset link to your email address.</span>
          </button>
          <button className="pwd__opt" type="button" onClick={() => setStep("text")}>
            <b>Reset by text</b>
            <span>Veye will text a one-time sign-in code to your phone. Coming soon.</span>
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

      {/* The prototype's phone step, as approved. No text-message provider is
          connected, so Send says so honestly instead of pretending
          (CLAUDE.md: a polished placeholder, never invented behaviour). */}
      {step === "text" && (
        <div className="pwd__step">
          <label className="pwd__label" htmlFor="pwPhone">Phone number</label>
          <div className="field">
            <input className={`field__input${phoneError ? " is-invalid" : ""}`} type="tel" id="pwPhone" placeholder="(555) 000-1234" autoComplete="tel"
                   value={phone} onChange={(event) => { setPhone(event.target.value); setPhoneError(""); }}
                   onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); sendText(); } }} />
          </div>
          {phoneError && <p className="pwd__err">{phoneError}</p>}
          <button className="btn btn--primary pwd__go" type="button" onClick={sendText}>Send sign-in code</button>
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
          {done.note && <p className={`pwd__proto${done.warn ? " pwd__proto--warn" : ""}`} role={done.warn ? "alert" : undefined}>{done.note}</p>}
          <button className="btn btn--primary pwd__go" type="button" onClick={onClose}>Back to sign in</button>
        </div>
      )}
    </dialog>
  );
}
