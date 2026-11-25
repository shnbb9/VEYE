"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon, PageHead, Subnav } from "@/components/admin/admin-chrome";
import { InviteMember } from "@/components/admin/invite-member";
import { MEMBER_VIEWS } from "@/components/admin/member-views";
import { MemberTable, useMembers } from "@/components/admin/member-table";

/* Members — the directory. Health sharing replaced the Trackers column (Cara,
   25 Nov 2026); the strip above it finds people who started and did not finish
   — three different groups, kept apart. */

export default function MembersPage() {
  const router = useRouter();
  const [inviting, setInviting] = useState(false);
  const members = useMembers({ q: "", status: "any", onboarding: "any", active: "any", sharing: "any", trend: "any", archived: "exclude",
    sort: "name", direction: "asc", page: 1, page_size: 25 });
  const { page, error, set } = members;
  const segments = page?.segments;

  return (
    <div className="page">
      <PageHead title="Members" desc={page ? `Everyone using Veye — ${page.total} member${page.total === 1 ? "" : "s"}${members.query.archived === "exclude" ? "" : " shown"}.` : "Everyone using Veye."}
                crumbs={[{ label: "Home", href: "/admin" }, { label: "Members" }]}
                actions={<button className="btn btn--primary" type="button" onClick={() => setInviting(true)} data-testid="add-member"><Icon name="plus" size={18} /> Add a member</button>} />
      <Subnav items={MEMBER_VIEWS} active="members" />
      {error && <p className="errorbar">{error}</p>}

      <div className="minirow minirow--links" data-testid="unfinished" role="group" aria-label="Started and not finished">
        <Link className="mini" href="/admin/members/prospects" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="mini__n" data-testid="segment-prospects">{segments?.prospects ?? "—"}</span><span className="mini__l">Took the quiz, no account</span>
        </Link>
        <button className="mini" type="button" onClick={() => set({ status: "unverified", onboarding: "any" })} data-testid="show-unverified">
          <span className="mini__n" data-testid="segment-unverified">{segments?.unverified ?? "—"}</span><span className="mini__l">Registered, email not verified</span>
        </button>
        <button className="mini" type="button" onClick={() => set({ status: "any", onboarding: "not_started" })} data-testid="show-incomplete">
          <span className="mini__n" data-testid="segment-onboarding">{segments?.onboarding_incomplete ?? "—"}</span><span className="mini__l">Verified, quiz not taken</span>
        </button>
        <Link className="mini" href="/admin/members/invitations" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="mini__n" data-testid="segment-invitations">{segments?.invitations_pending ?? "—"}</span><span className="mini__l">Invited, not joined yet</span>
        </Link>
      </div>

      <MemberTable {...members} />
      {inviting && <InviteMember onClose={() => setInviting(false)} onSent={(invitation) => router.push(`/admin/members/invitations?sent=${invitation.id}`)} />}
    </div>
  );
}
