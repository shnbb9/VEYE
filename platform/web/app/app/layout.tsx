import type { Metadata } from "next";
import { MemberChrome } from "@/components/member/member-chrome";

export const metadata: Metadata = {
  title: "Veye — Dashboard",
};

export default function MemberLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <MemberChrome>{children}</MemberChrome>;
}
