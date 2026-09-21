"use client";

import type { Account } from "@/lib/auth-api";
import { myPhotoUrl } from "@/lib/member-api";

/* One avatar for the whole member application: the signed-in member's
   uploaded photo when there is one (fetched with the session cookie), else
   that member's initial. The topbar control and the Settings photo both use
   it, so they can never show two different people. */
export function MemberAvatar({ account, className, size, testId }: { account: Account; className: string; size: "small" | "large"; testId?: string }) {
  const fullName = `${account.first_name} ${account.last_name}`.trim();
  if (account.photo_version) {
    return (
      <span className={`${className} member-avatar--photo`} role="img" aria-label={`Profile photo: ${fullName}`} data-testid={testId} data-has-photo="true">
        <img src={myPhotoUrl(account.photo_version)} alt="" crossOrigin="use-credentials" />
      </span>
    );
  }
  const initial = (account.first_name[0] ?? account.email[0] ?? "").toUpperCase();
  return (
    <span className={`${className} ${size === "large" ? "settings-photo--initial" : "avatar--initial"}`} role="img"
          aria-label={`Profile photo placeholder: ${fullName}`} data-testid={testId} data-has-photo="false">
      {initial}
    </span>
  );
}
