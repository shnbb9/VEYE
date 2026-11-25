"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AuthFrame, FormError, PasswordField } from "@/components/auth/auth-frame";
import { useSession } from "@/components/session";
import { acceptMemberInvitation, previewMemberInvitation, sessionNotKept, type MemberInvitationPreview } from "@/lib/auth-api";

/* Becoming a member by invitation. The link proves the mailbox; what it asks
   for depends on what already exists at that address — a new person, someone
   who registered and never verified, an administrator without a member
   profile (their own password, the same account), or somebody who is already
   a member. The token leaves the address bar as soon as it is read. */

const SUBTITLE: Record<MemberInvitationPreview["mode"], string> = {
  new_account: "Choose a password to open your own Veye dashboard.",
  confirm_existing: "This address was registered before and never verified. Choose a new password to make it yours; any earlier sign-in ends.",
  add_profile: "You already have a Veye administrator account. Enter its password to add your own member profile to it.",
  already_member: "You already have a Veye member account.",
};

export default function AcceptMemberInvitation() {
  const router = useRouter();
  const session = useSession();
  const link = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<MemberInvitationPreview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [names, setNames] = useState({ first: "", last: "" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<{ message: string; link?: { href: string; label: string } | null }>({ message: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Kept across a second run of this effect: by then it has left the address bar.
    link.current ??= new URLSearchParams(window.location.search).get("token") ?? "";
    const raw = link.current;
    if (!raw) { setLoadError("This link is missing its invitation."); return; }
    window.history.replaceState(null, "", "/accept-invitation");
    setToken(raw);
    let live = true;
    previewMemberInvitation(raw)
      .then((next) => { if (!live) return; setInvitation(next); setNames({ first: next.first_name, last: next.last_name }); })
      .catch((reason) => { if (live) setLoadError(reason instanceof Error ? reason.message : "This invitation link is not valid any more."); });
    return () => { live = false; };
  }, []);

  const existing = invitation?.mode === "add_profile";
  const choosing = invitation?.mode === "new_account" || invitation?.mode === "confirm_existing";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token || !invitation || busy) return;
    if (invitation.mode === "new_account" && !names.first.trim()) { setError({ message: "Please tell us your first name." }); return; }
    if (choosing && password.length < 12) { setError({ message: "Choose a password of at least 12 characters." }); return; }
    if (choosing && password !== confirm) { setError({ message: "The two passwords do not match." }); return; }
    setBusy(true); setError({ message: "" });
    try {
      const done = await acceptMemberInvitation({ token, first_name: names.first, last_name: names.last, password, remember: false });
      if (!done.account) { router.push("/login"); return; }
      const current = await session.refresh();
      if (!current.member) { setError(sessionNotKept("member", "Your account is ready", "/login")); return; }
      router.push("/app");
    } catch (reason) {
      setError({ message: reason instanceof Error ? reason.message : "The invitation could not be accepted." });
    } finally { setBusy(false); }
  }

  return (
    <AuthFrame photo="signup">
      <form className="auth__form" method="post" onSubmit={(event) => void submit(event)} noValidate data-testid="accept-member-invitation">
        <h1 className="auth__title">{loadError ? "This invitation cannot be used" : "Welcome to Veye"}</h1>
        {loadError ? (
          <>
            <p className="auth__notice auth__notice--warn" role="alert" data-testid="member-invitation-error">{loadError}</p>
            <p className="auth__links"><Link href="/login">Sign in</Link></p>
          </>
        ) : !invitation ? <p className="auth__subtitle">Checking your invitation…</p> : (
          <>
            <p className="auth__subtitle" data-testid="member-invitation-for">
              {invitation.invited_by ? `${invitation.invited_by} invited ` : "Invitation for "}<strong>{invitation.email}</strong>. {SUBTITLE[invitation.mode]}
            </p>
            {invitation.mode === "already_member" ? (
              <Link className="btn btn--primary btn--mt" href="/login">Sign in</Link>
            ) : (
              <>
                <div className="auth__fields">
                  {invitation.mode === "new_account" && (
                    <>
                      <div className="field"><input className="field__input" name="first_name" autoComplete="given-name" maxLength={120} placeholder="First name" aria-label="First name" value={names.first} onChange={(event) => setNames({ ...names, first: event.target.value })} /></div>
                      <div className="field"><input className="field__input" name="last_name" autoComplete="family-name" maxLength={120} placeholder="Last name" aria-label="Last name" value={names.last} onChange={(event) => setNames({ ...names, last: event.target.value })} /></div>
                    </>
                  )}
                  <PasswordField name="password" value={password} onChange={setPassword} placeholder={existing ? "Your console password" : "Choose a password"} autoComplete={existing ? "current-password" : "new-password"} />
                  {choosing && <PasswordField name="confirm" value={confirm} onChange={setConfirm} placeholder="Confirm password" autoComplete="new-password" />}
                </div>
                <p className="auth__subtitle">Nothing about your health is shared with anyone unless you choose to share it.</p>
                <FormError message={error.message} link={error.link} />
                <button type="submit" className="btn btn--primary btn--mt" disabled={busy} data-testid="accept-member-submit">{busy ? "Opening your dashboard…" : existing ? "Add my member profile" : "Open my dashboard"}</button>
                <p className="auth__links">By continuing you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</p>
              </>
            )}
          </>
        )}
      </form>
    </AuthFrame>
  );
}
