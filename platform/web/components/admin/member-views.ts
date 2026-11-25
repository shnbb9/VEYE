/** The views of the Members area: people with an account, how their Health
 *  Number is moving, people invited, visitors who saved a result without an
 *  account (architecture V2 §2.4), and deletions (§6). */
export const MEMBER_VIEWS = [
  { key: "members", label: "Members", href: "/admin/members" },
  { key: "trends", label: "Progress & trends", href: "/admin/members/trends" },
  { key: "invitations", label: "Invitations", href: "/admin/members/invitations" },
  { key: "prospects", label: "Prospects", href: "/admin/members/prospects" },
  { key: "deletions", label: "Deletions", href: "/admin/members/deletions" },
] as const;
