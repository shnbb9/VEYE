/* Health Number onboarding model — the ten approved screens covering the
   twelve canonical questions (build/js/quiz.js). Option labels are the API's
   scoring keys and match build/js/veye-calculations.js exactly; the points
   themselves live only in the API. */

export const goals = ["Manage Current Chronic Diseases", "Prevent Future Disease", "Live a Healthier Lifestyle", "Better Mental Focus", "Lose Body Fat"] as const;
export const plans = ["Weight Watchers", "Noom", "Jenny Craig", "The Mediterranean Diet", "DASH", "ATKINS", "Keto", "Intermittent Fasting", "Fasting"] as const;
export const activities = ["None", "Light (I work, I walk some)", "Moderate (I exercise 1-3 times a week)", "Heavy (I exercise 3x+ times per week)"] as const;
export const diets = ["Vegetarian", "Vegan", "Raw food", "Fish and no meat", "Fish/chicken/turkey and no red meat", "Gluten free", "Dairy free", "No preference"] as const;
export const sources = ["Instagram", "Facebook", "On-line search", "Friends or Family", "Recommended by a doctor"] as const;

export const NO_OTHER_PLANS = "No other plans";
export const TOTAL_QUESTIONS = 12;   // canonical Health Number questions, not screens

export type YesNo = "yes" | "no";

export type Answers = {
  goals: string[]; goalsOther: string;
  plans: string[]; plansOther: string;
  activity: string;
  meditate: YesNo | ""; tired: YesNo | ""; gainWeight: YesNo | ""; abdomenWeight: YesNo | "";
  sleep: { enough: YesNo | ""; well: YesNo | ""; hours: string };
  diet: { choice: string; other: string };
  source: { choice: string; other: string };
};

export const initialAnswers: Answers = {
  goals: [], goalsOther: "",
  plans: [], plansOther: "",
  activity: "",
  meditate: "", tired: "", gainWeight: "", abdomenWeight: "",
  sleep: { enough: "", well: "", hours: "" },
  diet: { choice: "", other: "" },
  source: { choice: "", other: "" },
};

export type Screen =
  | { id: "goals"; hn: number[]; type: "checkbox"; title: string; options: readonly string[]; otherWriteIn: string }
  | { id: "plans"; hn: number[]; type: "checkbox"; title: string; options: readonly string[]; otherWriteIn: string; exclusive: string }
  | { id: "activity"; hn: number[]; type: "radio"; title: string; options: readonly string[] }
  | { id: "meditate" | "tired" | "gainWeight" | "abdomenWeight"; hn: number[]; type: "yesno"; title: string }
  | { id: "sleep"; hn: number[]; type: "sleep" }
  | { id: "diet" | "source"; hn: number[]; type: "radioOther"; title: string; options: readonly string[]; otherPlaceholder: string };

export const SCREENS: readonly Screen[] = [
  { id: "goals", hn: [1], type: "checkbox", title: "What are your goals?", otherWriteIn: "Tell us your goal", options: goals },
  { id: "plans", hn: [2], type: "checkbox", title: "Have you tried other food plans?", exclusive: NO_OTHER_PLANS, otherWriteIn: "Enter the plan you tried", options: plans },
  { id: "activity", hn: [3], type: "radio", title: "Select your activity level", options: activities },
  { id: "meditate", hn: [4], type: "yesno", title: "Do you meditate?" },
  { id: "tired", hn: [5], type: "yesno", title: "Are you tired or do you have poor mental focus during the day?" },
  { id: "gainWeight", hn: [6], type: "yesno", title: "Do you gain weight quickly?" },
  { id: "abdomenWeight", hn: [7], type: "yesno", title: "Is most of your excess weight (if any) around your abdomen?" },
  { id: "sleep", hn: [8, 9, 10], type: "sleep" },
  { id: "diet", hn: [11], type: "radioOther", title: "What is your dietary preference?", options: diets, otherPlaceholder: "Enter your dietary preference" },
  { id: "source", hn: [12], type: "radioOther", title: "How did you find out about Veye?", options: sources, otherPlaceholder: "Enter information" },
];

/** Highest canonical question reached at a screen (drives the 12-segment bar). */
export function questionReached(index: number): number {
  for (let k = index; k >= 0; k--) {
    const hn = SCREENS[k].hn;
    if (hn.length) return hn[hn.length - 1];
  }
  return 0;
}

export function sleepHoursValid(hours: string): boolean {
  const n = Number(hours);
  return hours.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 24;
}

/** Per Arnold's Figma review comments: a step can't be advanced until answered. */
export function isAnswered(screen: Screen, a: Answers): boolean {
  switch (screen.type) {
    case "checkbox": return (a[screen.id] as string[]).length > 0;
    case "radio": return a.activity !== "";
    case "yesno": return a[screen.id] === "yes" || a[screen.id] === "no";
    case "sleep": return !!a.sleep.enough && !!a.sleep.well && sleepHoursValid(a.sleep.hours);
    case "radioOther": {
      const value = a[screen.id];
      if (!value.choice) return false;
      return value.choice === "Other" ? value.other.trim() !== "" : true;
    }
  }
}

/** The canonical request body for POST /api/v1/health-number/calculate. */
export function toApiAnswers(a: Answers) {
  const payload: Record<string, unknown> = {
    goals: a.goals,
    plans: a.plans,
    activity: a.activity,
    meditate: a.meditate,
    tired: a.tired,
    gainWeight: a.gainWeight,
    abdomenWeight: a.abdomenWeight,
    sleepEnough: a.sleep.enough,
    sleepWell: a.sleep.well,
    sleepHours: Number(a.sleep.hours),
    diet: a.diet.choice,
    source: a.source.choice,
  };
  if (a.goals.includes("Other") && a.goalsOther.trim()) payload.other_goal = a.goalsOther.trim();
  if (a.plans.includes("Other") && a.plansOther.trim()) payload.other_plan = a.plansOther.trim();
  if (a.diet.choice === "Other") payload.other_diet = a.diet.other.trim();
  if (a.source.choice === "Other") payload.other_source = a.source.other.trim();
  return payload;
}

export type HealthResult = {
  attempt_id: string; member_id: string; raw_score: number; displayed_score: number;
  status: string; bucket: string; category: string; category_rule: string;
  interpretation: string; calculation_version: string; completed_at: string;
};
