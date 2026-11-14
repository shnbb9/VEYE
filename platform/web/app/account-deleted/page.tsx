"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AuthFrame } from "@/components/auth/auth-frame";
import { apiJson } from "@/lib/api";

/* Where a member lands after deleting their member profile (architecture V2
   §6). Their member session has already ended, so this page needs none: the
   reference alone shows where the deletion stands — a state and dates, never
   anything about the person or what was removed. */

type Status = { request_id: string; state: string; state_label: string; scope: string; requested_at: string; completed_at: string | null };

export default function AccountDeletedPage() {
  return <Suspense fallback={null}><AccountDeleted /></Suspense>;
}

function AccountDeleted() {
  const params = useSearchParams();
  const ref = params.get("ref") ?? "";
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!/^[0-9a-f-]{36}$/i.test(ref)) { setError("This page needs the reference from your deletion."); return; }
    apiJson<Status>(`/api/v1/erasure-requests/${ref}`).then(setStatus)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "That reference was not found."));
  }, [ref]);

  return (
    <AuthFrame photo="login">
      <div className="auth__form" data-testid="account-deleted">
        <h1 className="auth__title">{status?.state === "erased" ? "Your member profile is deleted" : "Deleting your member profile"}</h1>
        {status && (
          <>
            <p className="auth__status" data-testid="account-deleted-state"><b>{status.state_label}.</b>{" "}
              {status.state === "erased"
                ? `Finished ${new Date(status.completed_at ?? status.requested_at).toLocaleString()}.`
                : "You have already been signed out of the member application, and nobody can open the profile while it is deleted."}</p>
            <p className="auth__notice">Reference <code data-testid="account-deleted-ref">{status.request_id}</code>. Keep it if you want to ask us about this deletion. We have also emailed you a receipt, which contains no health information.</p>
            {status.scope === "member_data" && (
              <p className="auth__notice">Your administrator access to the Veye console is unchanged. Remove it separately if you want to.</p>
            )}
          </>
        )}
        {error && <p className="auth__status" role="alert">{error}</p>}
        <Link className="btn btn--primary btn--mt" href="/">Back to Veye</Link>
      </div>
    </AuthFrame>
  );
}
