/* Sidebar order and labels are the approved prototype's (client, 20 Aug 2026):
   Dashboard · Veye Companion · My Progress · Mood Tracker · Food Choices ·
   Meal Planning · Food Diary · separator · Supplements · Fitness · Mindfulness ·
   Resources, plus Settings / Log out in the bottom block. */

export type NavKey =
  | "dashboard" | "companion" | "progress" | "mood" | "food-choices" | "meal-planning" | "food-diary"
  | "supplements" | "fitness" | "mindfulness" | "resources" | "settings";

export type NavItem = { key: NavKey; label: string; href: string; separatorBefore?: boolean };

export const MEMBER_NAV: readonly NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/app" },
  { key: "companion", label: "Veye Companion", href: "/app/companion" },
  { key: "progress", label: "My Progress", href: "/app/progress" },
  { key: "mood", label: "Mood Tracker", href: "/app/mood" },
  { key: "food-choices", label: "Food Choices", href: "/app/food-choices" },
  { key: "meal-planning", label: "Meal Planning", href: "/app/meal-planning" },
  { key: "food-diary", label: "Food Diary", href: "/app/food-diary" },
  { key: "supplements", label: "Supplements", href: "/app/supplements", separatorBefore: true },
  { key: "fitness", label: "Fitness", href: "/app/fitness" },
  { key: "mindfulness", label: "Mindfulness", href: "/app/mindfulness" },
  { key: "resources", label: "Resources", href: "/app/resources" },
];

/** The sidebar entry a route belongs to: nested My Progress screens keep
 *  My Progress highlighted, exactly as the prototype's sub-views do. */
export function activeNavKey(pathname: string | null): NavKey | null {
  if (!pathname) return null;
  if (pathname === "/app") return "dashboard";
  if (pathname.startsWith("/app/settings")) return "settings";
  const hit = MEMBER_NAV.find((item) => item.key !== "dashboard" && pathname.startsWith(item.href));
  return hit ? hit.key : null;
}
