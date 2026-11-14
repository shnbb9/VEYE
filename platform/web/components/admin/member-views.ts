/** The three views of the Members area: people with an account, visitors who
 *  saved a result without one (architecture V2 §2.4), and deletions (§6). */
export const MEMBER_VIEWS = [
  { key: "members", label: "Members", href: "/admin/members" },
  { key: "prospects", label: "Prospects", href: "/admin/members/prospects" },
  { key: "deletions", label: "Deletions", href: "/admin/members/deletions" },
] as const;
