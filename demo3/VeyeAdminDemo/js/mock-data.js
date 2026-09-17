/* ============================================================================
   Veye Admin Console — synthetic prototype data
   ----------------------------------------------------------------------------
   Every person, member record, message and figure below is fictional. The
   timeline is anchored on Friday 14 August 2026 so screens agree with each
   other.

   WHERE THE ASSESSMENT NUMBERS COME FROM
   The scoring definitions in this file are transcribed from the CANONICAL
   consumer engine, build/js/veye-calculations.js, which is itself sourced from
   the client documents (HealthNumbers.xlsx, Health Number Interpretation and
   Formula.docx, Health Assessment.docx, Simple Quiz.docx, BMI formula.docx,
   Dated Blood Markers tracking.pdf). The admin console never re-derives a
   weight, a band or a formula — it displays what the engine holds.

   Nothing here is approved clinical output.
   ============================================================================ */

(function () {

const TODAY_LABEL = 'Friday, 14 August 2026';
const SEED = {};

SEED.today = TODAY_LABEL;

/* ------------------------------------------------------------ organization -- */
SEED.org = {
  name: 'Veye Health',
  legalName: 'Veye Health, Inc.',
  supportEmail: 'support@veye.example',
  supportPhone: '+1 555 0100',
  address: '18 Harbour Street, Suite 400, Portland, OR 97204',
  timezone: 'America/Los_Angeles',
  dateFormat: 'D MMM YYYY',
  numberFormat: '1,234.5',
  weekStart: 'Monday',
  logo: 'assets/img/veye-logo.png',
};

/* --------------------------------------------------------------- the admins --
   No roles, no teams, no permission columns. Every administrator listed here
   has the same access to this console. */
SEED.admins = [
  { id: 'AD-01', name: 'Elena Fischer', initials: 'EF', email: 'elena.fischer@veye.example', invited: 'Accepted', invitedOn: '04 Jan 2026', lastActive: '14 Aug 2026, 07:30', status: 'Active' },
  /* The signed-in administrator. Cara HOGUE — not Cara MORGAN, who is the sample
     member HM-001238. Two different people who happen to share a first name, so
     never write one where the other belongs: the surname is the whole
     distinction and dropping it makes the demo read as if an administrator were
     looking at their own file. */
  { id: 'AD-02', name: 'Cara Hogue',    initials: 'CH', email: 'cara.hogue@veye.example',    invited: 'Accepted', invitedOn: '04 Jan 2026', lastActive: '14 Aug 2026, 08:12', status: 'Active' },
  { id: 'AD-03', name: 'James Lee',     initials: 'JL', email: 'james.lee@veye.example',     invited: 'Accepted', invitedOn: '11 Feb 2026', lastActive: '14 Aug 2026, 07:55', status: 'Active' },
  { id: 'AD-04', name: 'Priya Shah',    initials: 'PS', email: 'priya.shah@veye.example',    invited: 'Accepted', invitedOn: '11 Feb 2026', lastActive: '13 Aug 2026, 18:40', status: 'Active' },
  { id: 'AD-05', name: 'Maya Patel',    initials: 'MP', email: 'maya.patel@veye.example',    invited: 'Accepted', invitedOn: '02 Mar 2026', lastActive: '14 Aug 2026, 08:20', status: 'Active' },
  { id: 'AD-06', name: 'Dr Ana Ruiz',   initials: 'AR', email: 'ana.ruiz@veye.example',      invited: 'Accepted', invitedOn: '02 Mar 2026', lastActive: '13 Aug 2026, 16:05', status: 'Active' },
  { id: 'AD-07', name: 'Nina Alvarez',  initials: 'NA', email: 'nina.alvarez@veye.example',  invited: 'Accepted', invitedOn: '19 Apr 2026', lastActive: '13 Aug 2026, 15:22', status: 'Active' },
  { id: 'AD-08', name: 'Tom Becker',    initials: 'TB', email: 'tom.becker@veye.example',    invited: 'Accepted', invitedOn: '19 Apr 2026', lastActive: '14 Aug 2026, 08:02', status: 'Active' },
  { id: 'AD-09', name: 'Owen Wright',   initials: 'OW', email: 'owen.wright@veye.example',   invited: 'Accepted', invitedOn: '30 May 2026', lastActive: '14 Aug 2026, 08:28', status: 'Active' },
  { id: 'AD-10', name: 'Jonah Reid',    initials: 'JR', email: 'jonah.reid@veye.example',    invited: 'Pending',  invitedOn: '12 Aug 2026', lastActive: '—',                  status: 'Active' },
  { id: 'AD-11', name: 'Sara Okafor',   initials: 'SO', email: 'sara.okafor@veye.example',   invited: 'Accepted', invitedOn: '14 Sep 2025', lastActive: '02 Jul 2026, 11:10', status: 'Deactivated' },
];

/* The signed-in administrator. */
SEED.me = {
  id: 'AD-02',
  name: 'Cara Hogue',
  initials: 'CH',
  email: 'cara.hogue@veye.example',
  phone: '+1 555 0118',
  timezone: 'America/Los_Angeles',
  dateFormat: 'D MMM YYYY',
  mfa: 'Enabled',
  mfaMethod: 'Authenticator app',
  /* How this administrator wants the console drawn. Their own preference, not a
     setting that reaches any member. `motion: 'reduce'` can only add stillness —
     there is deliberately no value that forces animation on. Navigation is not
     here: it is `railCollapsed`, which the rail's own Collapse button already
     writes, and two keys for one choice would drift apart. */
  display: { density: 'comfortable', motion: 'system', data: 'visual' },
  emailPrefs: { attention: true, weekly: true, product: false, security: true },
  appPrefs: { attention: true, messages: true, mentions: true, contentChanges: false },
  sessions: [
    { id: 'SE-1', device: 'Chrome on Windows', where: 'Portland, OR', started: '14 Aug 2026, 07:58', current: true },
    { id: 'SE-2', device: 'Safari on iPhone',  where: 'Portland, OR', started: '13 Aug 2026, 19:04', current: false },
    { id: 'SE-3', device: 'Chrome on macOS',   where: 'Seattle, WA',  started: '09 Aug 2026, 10:41', current: false },
  ],
};

/* ------------------------------------------------------------------ members --
   HEALTH NUMBER DIRECTION — read before touching any `hn` value.
   The canonical engine states plainly: "Lower is healthier (1 = great,
   10 = poor)". Bands: <=1 Good Health, <=3.5 Relatively Good Health,
   <=6 Moderately Good Health, >6 Insulin Resistance Risk. Every `hn` and
   `hnBand` below follows that direction, and `hnTrend` is the change since the
   previous assessment, so a NEGATIVE trend is an improvement. Screens must say
   so in words rather than relying on an arrow. */
const M = (o) => ({
  program: null, adherence: null, attention: 0, tags: [], consent: 'Current',
  subscription: 'DIY', onboarding: 'Complete', status: 'Active', ...o,
});

SEED.members = [
  M({ id: 'HM-001238', name: 'Cara Morgan', initials: 'CM', email: 'cara.m@example.com', joined: '12 Feb 2026',
      hn: 3.5, hnTrend: -0.5, hnBand: 'Relatively Good Health', hnTaken: '02 Aug 2026',
      lastActive: '14 Aug 2026, 07:40', program: 'Stabilize Your Day', adherence: 82, attention: 1,
      tags: ['Blood markers'], dob: '11 Mar 1984', phone: '+1 555 0142', city: 'Portland, OR' }),
  M({ id: 'HM-001817', name: 'Lena Ortiz', initials: 'LO', email: 'lena.o@example.com', joined: '02 Mar 2026',
      hn: 2.5, hnTrend: -0.5, hnBand: 'Relatively Good Health', hnTaken: '28 Jul 2026',
      lastActive: '14 Aug 2026, 06:05', program: 'Steady Mornings', adherence: 74, attention: 1,
      tags: ['Companion'], dob: '22 Jul 1991', phone: '+1 555 0188', city: 'Austin, TX' }),
  M({ id: 'HM-002341', name: 'Maya Chen', initials: 'MC', email: 'maya.c@example.com', joined: '09 Aug 2026',
      hn: null, hnTrend: null, hnBand: 'Not completed', hnTaken: '—',
      lastActive: '11 Aug 2026, 21:14', onboarding: 'Stalled at step 7 of 12', attention: 1,
      tags: ['New'], subscription: 'Trial', dob: '30 Jan 1996', phone: '+1 555 0210', city: 'Denver, CO' }),
  M({ id: 'HM-000992', name: 'Robert Williams', initials: 'RW', email: 'robert.w@example.com', joined: '18 Nov 2025',
      hn: 7.5, hnTrend: +0.5, hnBand: 'Insulin Resistance Risk', hnTaken: '04 Aug 2026',
      lastActive: '13 Aug 2026, 20:02', program: 'Stabilize Your Day', adherence: 51, attention: 2,
      tags: ['Mood', 'Priority'], subscription: 'Guided', dob: '04 Sep 1968', phone: '+1 555 0165', city: 'Chicago, IL' }),
  M({ id: 'HM-001556', name: 'Sophie Patel', initials: 'SP', email: 'sophie.p@example.com', joined: '21 Apr 2026',
      hn: 4.5, hnTrend: 0, hnBand: 'Moderately Good Health', hnTaken: '19 Jul 2026',
      lastActive: '12 Aug 2026, 09:30', program: 'Nutrition Reset', adherence: 12, attention: 1,
      tags: ['Nutrition'], dob: '15 Dec 1989', phone: '+1 555 0177', city: 'Seattle, WA' }),
  M({ id: 'HM-002118', name: 'Daniel Kim', initials: 'DK', email: 'daniel.k@example.com', joined: '30 Jun 2026',
      hn: 5.0, hnTrend: -1.0, hnBand: 'Moderately Good Health', hnTaken: '06 Aug 2026',
      lastActive: '13 Aug 2026, 12:45', program: 'Nutrition Reset', adherence: 66, attention: 1,
      tags: ['Supplements'], dob: '19 May 1993', phone: '+1 555 0199', city: 'Boston, MA' }),
  M({ id: 'HM-002402', name: 'Aisha Bello', initials: 'AB', email: 'aisha.b@example.com', joined: '01 Jul 2026',
      hn: 1.0, hnTrend: -0.5, hnBand: 'Good Health', hnTaken: '01 Aug 2026',
      lastActive: '14 Aug 2026, 07:02', program: 'Steady Mornings', adherence: 91,
      tags: ['Advocate'], subscription: 'Guided', dob: '28 Feb 1987', phone: '+1 555 0221', city: 'Miami, FL' }),
  M({ id: 'HM-001045', name: 'Tomás Rivera', initials: 'TR', email: 'tomas.r@example.com', joined: '05 Jan 2026',
      hn: 4.0, hnTrend: +0.5, hnBand: 'Moderately Good Health', hnTaken: '11 Jul 2026',
      lastActive: '10 Aug 2026, 17:20', program: 'Stabilize Your Day', adherence: 58,
      tags: [], dob: '08 Nov 1975', phone: '+1 555 0233', city: 'Phoenix, AZ' }),
  M({ id: 'HM-002590', name: 'Grace Lin', initials: 'GL', email: 'grace.l@example.com', joined: '28 Jul 2026',
      hn: null, hnTrend: null, hnBand: 'Not completed', hnTaken: '—',
      lastActive: '13 Aug 2026, 08:11', onboarding: 'Step 4 of 12', subscription: 'Trial',
      tags: ['New'], dob: '12 Jun 1998', phone: '+1 555 0244', city: 'San Diego, CA' }),
  M({ id: 'HM-000731', name: 'Peter Novak', initials: 'PN', email: 'peter.n@example.com', joined: '14 Sep 2025',
      hn: 3.0, hnTrend: -0.5, hnBand: 'Relatively Good Health', hnTaken: '11 Feb 2026',
      lastActive: '09 Aug 2026, 14:00', program: 'Nutrition Reset', adherence: 70,
      tags: ['Renewal due'], subscription: 'Guided', dob: '02 Apr 1970', phone: '+1 555 0255', city: 'Minneapolis, MN' }),
  M({ id: 'HM-002777', name: 'Hannah Weiss', initials: 'HW', email: 'hannah.w@example.com', joined: '03 Aug 2026',
      hn: 2.0, hnTrend: -1.0, hnBand: 'Relatively Good Health', hnTaken: '10 Aug 2026',
      lastActive: '14 Aug 2026, 06:48', program: 'Steady Mornings', adherence: 88,
      tags: [], dob: '25 Oct 1990', phone: '+1 555 0266', city: 'Nashville, TN' }),
  M({ id: 'HM-000488', name: 'Sam Okonkwo', initials: 'SO', email: 'sam.o@example.com', joined: '22 Jun 2025',
      hn: 6.5, hnTrend: +1.0, hnBand: 'Insulin Resistance Risk', hnTaken: '02 Jun 2026',
      lastActive: '01 Aug 2026, 10:05', status: 'Paused', subscription: 'Lapsed', adherence: null,
      tags: ['Payment failed'], consent: 'Renewal due', dob: '17 Aug 1982', phone: '+1 555 0277', city: 'Atlanta, GA' }),
];

/* ------------------------------------------------------ needs attention -----
   Plain-language operational items. No approvals, no governance queue. */
SEED.attention = [
  { id: 'AT-4821', memberId: 'HM-001238', member: 'Cara Morgan', kind: 'Blood markers', title: 'New blood results to look at',
    detail: 'Six markers came in at 06:40 today. TG/HDL and HOMA-IR have both been calculated and nobody has opened them yet.',
    priority: 'High', age: '2 hours ago', due: 'Today' },
  { id: 'AT-4822', memberId: 'HM-001817', member: 'Lena Ortiz', kind: 'Companion', title: 'Companion reply held for review',
    detail: 'Sprout paused a reply about taking magnesium alongside omega-3. The member has not seen it.',
    priority: 'High', age: '4 hours ago', due: 'Today' },
  { id: 'AT-4823', memberId: 'HM-002341', member: 'Maya Chen', kind: 'Onboarding', title: 'Onboarding stopped part-way',
    detail: 'Stopped at step 7 of 12, the blood marker step, three days ago and has not come back.',
    priority: 'Medium', age: '1 day ago', due: '15 Aug' },
  { id: 'AT-4824', memberId: 'HM-000992', member: 'Robert Williams', kind: 'Mood', title: 'Three low mood days in a row',
    detail: 'Three consecutive low entries, each mentioning broken sleep. Worth a human read before anything else happens.',
    priority: 'Medium', age: '1 day ago', due: '15 Aug' },
  { id: 'AT-4825', memberId: 'HM-001556', member: 'Sophie Patel', kind: 'Plan', title: 'Assigned plan never opened',
    detail: 'Nutrition Reset was assigned nine days ago. No meal plan opened and no diary entries since.',
    priority: 'Low', age: '2 days ago', due: '16 Aug' },
  { id: 'AT-4826', memberId: 'HM-002118', member: 'Daniel Kim', kind: 'Message', title: 'Question waiting for a reply',
    detail: 'Asked about omega-3 timing on 12 August. No reply yet.',
    priority: 'Low', age: '2 days ago', due: '16 Aug' },
  { id: 'AT-4827', memberId: 'HM-000488', member: 'Sam Okonkwo', kind: 'Billing', title: 'Renewal payment failed twice',
    detail: 'Declined on 1 and 8 August. Access is paused until it is resolved.',
    priority: 'Medium', age: '6 days ago', due: '15 Aug' },
  { id: 'AT-4828', memberId: 'HM-000731', member: 'Peter Novak', kind: 'Assessment', title: 'Health Number retake is due',
    detail: 'Last completed 11 February 2026. The retake reminder is six months.',
    priority: 'Low', age: '3 days ago', due: '18 Aug' },
  { id: 'AT-4829', memberId: 'HM-002590', member: 'Grace Lin', kind: 'Onboarding', title: 'Onboarding incomplete',
    detail: 'Step 4 of 12 since 7 August. No reminder has been sent yet.',
    priority: 'Low', age: '4 days ago', due: '17 Aug' },
  { id: 'AT-4830', memberId: null, member: '—', kind: 'System', title: 'Lab import rejected two rows',
    detail: 'Two of fourteen rows failed on 13 August because the HDL unit was not recognised.',
    priority: 'Medium', age: '1 day ago', due: '15 Aug' },
];

/* ------------------------------------------------------------- programs ----- */
SEED.programs = [
  { id: 'PR-01', name: 'Stabilize Your Day', audience: 'Members with irregular meal timing', status: 'Live', version: 'v3.1', updated: '02 Aug 2026', members: 214, completion: 68, weeks: 8 },
  { id: 'PR-02', name: 'Steady Mornings', audience: 'New members in their first 30 days', status: 'Live', version: 'v2.4', updated: '28 Jul 2026', members: 168, completion: 74, weeks: 4 },
  { id: 'PR-03', name: 'Nutrition Reset', audience: 'Members choosing favourable carbohydrates', status: 'Live', version: 'v1.9', updated: '19 Jul 2026', members: 96, completion: 55, weeks: 6 },
  { id: 'PR-04', name: 'Metabolic Health Program', audience: 'Raised TG/HDL ratio', status: 'Draft', version: 'v1.0 draft', updated: '14 Aug 2026', members: 0, completion: null, weeks: 10 },
  { id: 'PR-05', name: 'Longevity Nutrition Plan', audience: 'Guided subscribers', status: 'Draft', version: 'v0.4 draft', updated: '14 Aug 2026', members: 0, completion: null, weeks: 8 },
  { id: 'PR-06', name: 'Movement Foundations', audience: 'Low reported activity', status: 'Paused', version: 'v1.2', updated: '11 Jun 2026', members: 41, completion: 32, weeks: 6 },
  { id: 'PR-07', name: 'Winter Reset 2025', audience: 'Seasonal cohort', status: 'Archived', version: 'v1.0', updated: '04 Mar 2026', members: 302, completion: 81, weeks: 6 },
];

SEED.programSteps = [
  /* PR-01 Stabilize Your Day — 8 weeks */
  { id: 'PS-1',  programId: 'PR-01', week: 1, type: 'Assessment',    title: 'Health Number check-in',       timing: 'Day 1',  detail: 'The full 12-question assessment' },
  { id: 'PS-2',  programId: 'PR-01', week: 1, type: 'Message',       title: 'Welcome from your coach',      timing: 'Day 1',  detail: 'Message template WEL-02' },
  { id: 'PS-3',  programId: 'PR-01', week: 1, type: 'Food choice',   title: 'Choose your proteins',         timing: 'Day 2',  detail: 'Protein portal, five selections' },
  { id: 'PS-4',  programId: 'PR-01', week: 2, type: 'Meal plan',     title: 'Build your first day',         timing: 'Day 8',  detail: 'Meal Planning template: Balanced Start' },
  { id: 'PS-5',  programId: 'PR-01', week: 2, type: 'Mood check-in', title: 'Daily mood prompt',            timing: 'Daily',  detail: 'Reminder at 20:00 local time' },
  { id: 'PS-6',  programId: 'PR-01', week: 3, type: 'Food diary',    title: 'Three-day diary',              timing: 'Day 15', detail: 'Prompt with a reminder at 21:00' },
  { id: 'PS-7',  programId: 'PR-01', week: 4, type: 'Coach review',  title: 'Mid-point review',             timing: 'Day 22', detail: 'Coach checkpoint, 25 minutes' },
  { id: 'PS-8',  programId: 'PR-01', week: 6, type: 'Resource',      title: 'Understanding inflammation',   timing: 'Day 36', detail: 'Resource RS-14' },
  { id: 'PS-9',  programId: 'PR-01', week: 8, type: 'Assessment',    title: 'Closing Health Number retake', timing: 'Day 52', detail: 'Compared against day 1' },
  /* PR-02 Steady Mornings — 4 weeks */
  { id: 'PS-11', programId: 'PR-02', week: 1, type: 'Message',       title: 'Welcome from your coach',      timing: 'Day 1',  detail: 'Message template WEL-01' },
  { id: 'PS-12', programId: 'PR-02', week: 1, type: 'Assessment',    title: 'Health Number check-in',       timing: 'Day 2',  detail: 'The full 12-question assessment' },
  { id: 'PS-13', programId: 'PR-02', week: 1, type: 'Habit',         title: 'Set a consistent wake time',   timing: 'Day 3',  detail: 'Member picks a 30-minute window' },
  { id: 'PS-14', programId: 'PR-02', week: 2, type: 'Meal plan',     title: 'Plan your first breakfast',    timing: 'Day 8',  detail: 'Meal Planning template: Balanced Start' },
  { id: 'PS-15', programId: 'PR-02', week: 2, type: 'Mood check-in', title: 'Morning mood prompt',          timing: 'Daily',  detail: 'Reminder at 08:00 local time' },
  { id: 'PS-16', programId: 'PR-02', week: 3, type: 'Resource',      title: 'Why mornings set the day',     timing: 'Day 15', detail: 'Resource RS-06' },
  { id: 'PS-17', programId: 'PR-02', week: 3, type: 'Coach review',  title: 'Two-week check-in',            timing: 'Day 17', detail: 'Coach checkpoint, 20 minutes' },
  { id: 'PS-18', programId: 'PR-02', week: 4, type: 'Food diary',    title: 'Three-day diary',              timing: 'Day 22', detail: 'Prompt with a reminder at 21:00' },
  { id: 'PS-19', programId: 'PR-02', week: 4, type: 'Assessment',    title: 'Closing Health Number retake', timing: 'Day 26', detail: 'Compared against day 2' },
  /* PR-03 Nutrition Reset — 6 weeks */
  { id: 'PS-20', programId: 'PR-03', week: 1, type: 'Assessment',    title: 'Health Number check-in',       timing: 'Day 1',  detail: 'The full 12-question assessment' },
  { id: 'PS-21', programId: 'PR-03', week: 1, type: 'Food choice',   title: 'Choose your proteins',         timing: 'Day 2',  detail: 'Protein portal, five selections' },
  { id: 'PS-22', programId: 'PR-03', week: 1, type: 'Food choice',   title: 'Choose your favourable carbs', timing: 'Day 3',  detail: 'Favorable Carbohydrates portal, five selections' },
  { id: 'PS-23', programId: 'PR-03', week: 2, type: 'Meal plan',     title: 'Build your first week',        timing: 'Day 8',  detail: 'Meal Planning template: Reset Week' },
  { id: 'PS-24', programId: 'PR-03', week: 2, type: 'Food diary',    title: 'Daily diary prompt',           timing: 'Daily',  detail: 'Reminder at 21:00 local time' },
  { id: 'PS-25', programId: 'PR-03', week: 3, type: 'Resource',      title: 'Reading a food label',         timing: 'Day 15', detail: 'Resource RS-09' },
  { id: 'PS-26', programId: 'PR-03', week: 4, type: 'Coach review',  title: 'Mid-point review',             timing: 'Day 22', detail: 'Coach checkpoint, 25 minutes' },
  { id: 'PS-27', programId: 'PR-03', week: 5, type: 'Meal plan',     title: 'Rebuild with what worked',     timing: 'Day 29', detail: 'Member edits their own template' },
  { id: 'PS-28', programId: 'PR-03', week: 6, type: 'Assessment',    title: 'Closing Health Number retake', timing: 'Day 38', detail: 'Compared against day 1' },
];

/* ===========================================================================
   ASSESSMENTS AND RULES — transcribed from build/js/veye-calculations.js
   =========================================================================== */

/* Health Number — 12 questions. Q1, Q11 and Q12 carry no points and exist for
   personalisation. Lower is healthier. */
SEED.healthNumber = {
  version: 'v4.4',
  effective: '10 Sep 2026',
  scale: '1 to 10 published, rounded to the nearest 0.5; the raw weighted total may be lower',
  direction: 'Lower is healthier. 1 is great, 10 is poor.',
  membersScored: 1284,
  source: 'HealthNumbers.xlsx, via the consumer scoring engine',
  questions: [
    { id: 'Q1', text: 'What are your goals?', type: 'Multiple choice', scored: false,
      note: 'Carries no points. Used to personalise the plan.',
      options: [
        { label: 'Manage Current Chronic Diseases', points: 0 },
        { label: 'Prevent Future Disease', points: 0 },
        { label: 'Live a Healthier Lifestyle', points: 0 },
        { label: 'Better Mental Focus', points: 0 },
        { label: 'Lose Body Fat', points: 0 }, { label: 'Other', points: 0 },
      ] },
    { id: 'Q2', text: 'Have you tried other food plans?', type: 'Multiple choice', scored: true, group: 'Food',
      note: '"No other plans" is exclusive and scores 0. A written-in plan scores as Other.',
      options: [
        { label: 'Weight Watchers', points: 0.5 }, { label: 'Noom', points: 0.5 },
        { label: 'Jenny Craig', points: 0.5 }, { label: 'The Mediterranean Diet', points: 0.5 },
        { label: 'DASH', points: 0.5 }, { label: 'ATKINS', points: 1.5 },
        { label: 'Keto', points: 1.5 }, { label: 'Intermittent Fasting', points: 0.5 },
        { label: 'Fasting', points: 0.5 }, { label: 'Other', points: 0.5 },
        { label: 'No other plans', points: 0 },
      ] },
    { id: 'Q3', text: 'Select your activity level', type: 'Single choice', scored: true, group: 'Lifestyle',
      options: [
        { label: 'None', points: 1 },
        { label: 'Light (I work, I walk some)', points: 0 },
        { label: 'Moderate (I exercise 1-3 times a week)', points: -1 },
        { label: 'Heavy (I exercise 3x+ times per week)', points: -1 },
      ] },
    { id: 'Q4', text: 'Do you meditate?', type: 'Yes / No', scored: true, group: 'Lifestyle',
      options: [{ label: 'Yes', points: -0.5 }, { label: 'No', points: 0.5 }] },
    { id: 'Q5', text: 'Are you tired or do you have poor mental focus during the day?', type: 'Yes / No', scored: true, group: 'Food',
      /* Updated 20 Aug 2026 per Health Numbers Metrics Nile site.xlsx: Yes is
         0.5 (it was 1.5 in the earlier sheet). */
      options: [{ label: 'Yes', points: 0.5 }, { label: 'No', points: 0 }] },
    { id: 'Q6', text: 'Do you gain weight quickly?', type: 'Yes / No', scored: true, group: 'Food',
      options: [{ label: 'Yes', points: 1 }, { label: 'No', points: 0 }] },
    { id: 'Q7', text: 'Is most of your excess weight (if any) around your abdomen?', type: 'Yes / No', scored: true, group: 'Food',
      options: [{ label: 'Yes', points: 0.5 }, { label: 'No', points: 0 }] },
    { id: 'Q8', text: 'Do you feel like you get enough sleep?', type: 'Yes / No', scored: true, group: 'Lifestyle',
      options: [{ label: 'Yes', points: 0 }, { label: 'No', points: 1.5 }] },
    { id: 'Q9', text: 'Do you sleep well?', type: 'Yes / No', scored: true, group: 'Lifestyle',
      options: [{ label: 'Yes', points: 0 }, { label: 'No', points: 1.5 }] },
    { id: 'Q10', text: 'How many hours do you sleep per night?', type: 'Number', scored: true, group: 'Lifestyle',
      options: [
        { label: 'Fewer than 5 hours', points: 1 },
        { label: '5 to 9 hours', points: 0 },
        { label: 'More than 9 hours', points: 1 },
      ] },
    { id: 'Q11', text: 'What is your dietary preference?', type: 'Single choice', scored: false,
      note: 'Carries no points. Used to filter food and meal suggestions.',
      options: [
        { label: 'Vegetarian', points: 0 }, { label: 'Vegan', points: 0 },
        { label: 'Raw food', points: 0 }, { label: 'Fish and no meat', points: 0 },
        { label: 'Fish/chicken/turkey and no red meat', points: 0 },
        { label: 'Gluten free', points: 0 }, { label: 'Dairy free', points: 0 },
        { label: 'No preference', points: 0 }, { label: 'Other', points: 0 },
      ] },
    { id: 'Q12', text: 'How did you find out about Veye?', type: 'Single choice', scored: false,
      note: 'Carries no points. ONBOARDING ONLY — the dashboard retake omits this question (client, 20 Aug 2026: "we already know how they found out about us").',
      onboardingOnly: true,
      options: [
        { label: 'Instagram', points: 0 }, { label: 'Facebook', points: 0 },
        { label: 'On-line search', points: 0 }, { label: 'Friends or Family', points: 0 },
        { label: 'Recommended by a doctor', points: 0 }, { label: 'Other', points: 0 },
      ] },
  ],
  bands: [
    { upTo: 1,   label: 'Good Health',
      copy: 'You are in very good health — join and learn more about optimizing your health, preventing disease, and slowing the aging process.' },
    { upTo: 3.5, label: 'Relatively Good Health',
      copy: 'You are in relatively good health, and some lifestyle changes and adjustments to your dietary program will help you optimize your health, prevent disease, and slow the aging process.' },
    { upTo: 6,   label: 'Moderately Good Health',
      copy: 'Although you are in moderately good health, incorporating better food choices and implementing some lifestyle changes will help you optimize your health, prevent disease, and slow the aging process.' },
    { upTo: 10,  label: 'Insulin Resistance Risk',
      copy: 'You show signs of insulin resistance, which will lead to chronic disease or a worsening of established chronic disease. Join the Program and we can help you make changes so you feel better and live longer.' },
  ],
  grouping: {
    note: 'The middle two bands change their wording depending on where the points came from.',
    lifestyle: ['Q3', 'Q4', 'Q8', 'Q9', 'Q10'],
    food: ['Q2', 'Q5', 'Q6', 'Q7'],
    rule: 'For scores from 1.5 to 3.5, use the mostly Lifestyle, mostly Food, or Mixed wording according to the high answers. For scores from 4 to 6, use the wording for whichever group has more high answers; use the Mixed wording for a tie. For scores from 6.5 to 10, use the Insulin Resistance Risk wording for any combination.',
  },
  /* RESOLVED 20 Aug 2026 (Nile Site Health Number Interpretation and
     Formula.docx): "-1 and this defaults to 1". The published floor is 1. */
  floor: {
    value: 1,
    resolved: '20 Aug 2026',
    note: 'A member with no scoring answers and moderate or heavy exercise totals −1; the published number floors at 1. Resolved by the client on 20 Aug 2026 — the engine and both member quizzes clamp to 1.',
  },
  personas: [
    { id: 'PP-1', name: 'Sedentary, high stress, broken sleep',
      answers: { Q3: 'None', Q4: 'No', Q5: 'Yes', Q8: 'No', Q9: 'No' }, score: 5.0 },
    { id: 'PP-2', name: 'Active, sleeps well, no other plans',
      answers: { Q2: 'No other plans', Q3: 'Heavy (I exercise 3x+ times per week)', Q4: 'Yes', Q8: 'Yes', Q9: 'Yes' }, score: 1 },
    { id: 'PP-3', name: 'Keto history, gains weight quickly',
      answers: { Q2: 'Keto', Q3: 'Light (I work, I walk some)', Q4: 'No', Q6: 'Yes', Q7: 'Yes' }, score: 3.5 },
    { id: 'PP-4', name: 'Sleeps fine, diet is the problem',
      answers: { Q2: 'ATKINS', Q3: 'Moderate (I exercise 1-3 times a week)', Q5: 'Yes', Q6: 'Yes' }, score: 2.0 },
  ],
  versions: [
    { version: 'v4.4', effective: '10 Sep 2026', note: 'Current. The Start the Process review replaces Twitter with Facebook and adds Recommended by a doctor to the onboarding-only referral question. Scoring remains unchanged.', current: true },
    { version: 'v4.3', effective: '20 Aug 2026', note: 'Q5 (tired / poor focus) set to 0.5 for Yes per Health Numbers Metrics Nile site.xlsx; the published floor resolved to 1; the 0–1 band reads "very good health"; the referral question marked onboarding-only.' },
    { version: 'v4.2', effective: '02 Jun 2026', note: 'Meditation set to −0.5 for Yes and +0.5 for No, matching the spreadsheet.' },
    { version: 'v4.1', effective: '14 Feb 2026', note: 'Corrected the Heavy activity option label so it scored −1 instead of 0.' },
    { version: 'v4.0', effective: '11 Nov 2025', note: 'Moved from 13 questions to the canonical 12.' },
  ],
};

/* Health Assessment (source file: Health Assessment.docx) — 11 questions,
   first choice 1, middle 2, third 3. Lower totals mean lower inflammation. */
SEED.statusReport = {
  version: 'v1.7',
  effective: '28 Aug 2026',
  membersScored: 412,
  scale: 'Total of 11 to 33. Lower is better: 11 is low inflammation and 33 is high inflammation.',
  source: 'Health Assessment.docx',
  scoring: 'Each of the eleven questions offers three answers. The first scores 1, the second 2, and the third 3.',
  bands: [
    { from: 11, to: 11, label: 'Very Low Inflammation', copy: 'On a scale of 11 to 33, you have very low inflammation. What you are eating is working well for you and few adjustments are needed.' },
    { from: 12, to: 16, label: 'Low Inflammation', copy: 'You have low inflammation. What you are eating is good. Making some improvements and following the Veye guidelines will decrease inflammation even more.' },
    { from: 17, to: 22, label: 'Moderate Inflammation', copy: 'You have moderate inflammation. You can improve your health with the Veye guidelines.' },
    { from: 23, to: 27, label: 'High Inflammation', copy: 'Your inflammation is high — you may already have a chronic disease, and if not you are at risk of developing a chronic disease. Following the Veye guidelines will significantly improve your health.' },
    { from: 28, to: 32, label: 'Significant Inflammation', copy: 'You have significant inflammation. You may already have a chronic disease, and if not you are at risk of developing a chronic disease. The Veye guidelines can help you make the foods you already eat healthier by combining the right ratios of proteins, carbohydrates and fats.' },
    { from: 33, to: 33, label: 'High Inflammation / Poor Health', copy: 'Your inflammation is high and your health is poor. Try incorporating the Veye program as much as possible. Start with small changes.' },
  ],
  /* The supplement rows use DIFFERENT boundaries from the bands above. That is
     what the source says, so they stay two separate lookups. */
  dosage: [
    { from: 11, to: 17, epa: '2.5g', poly: '500mg / 1000mg / 1500mg', note: 'EPA/DHA varies by total; all three supplied polyphenol lines remain available.' },
    { from: 18, to: 21, epa: '5g',   poly: '500mg / 1000mg / 1500mg', note: 'EPA/DHA varies by total; all three supplied polyphenol lines remain available.' },
    { from: 22, to: 33, epa: '7.5g', poly: '500mg / 1000mg / 1500mg', note: 'EPA/DHA varies by total; all three supplied polyphenol lines remain available.' },
  ],
  separateRow: { condition: 'Neurological disorders', epa: '10g', poly: '500mg / 1000mg / 1500mg', note: 'Condition-based guidance; never applied from the total alone.' },
  boundaryNote: 'The assessment bands and the supplement boundaries are separate lookups. EPA/DHA is 2.5g for totals 11–17, 5g for 18–21 and 7.5g for 22–33. The three polyphenol lines remain available at every level. Neurological guidance is condition-based and is never inferred from the total alone.',
  versions: [
    { version: 'v1.7', effective: '28 Aug 2026', note: 'Current. Client correction: first choice scores 1, third scores 3, and lower inflammation totals are better. Bands and EPA/DHA rows follow Health Assessment.docx.', current: true },
    { version: 'v1.6', effective: '20 May 2026', note: 'Previous version. Used the superseded higher-is-better direction.' },
    { version: 'v1.5', effective: '02 Feb 2026', note: 'Added the separate neurological row so it is never applied from the score alone.' },
    { version: 'v1.4', effective: '11 Oct 2025', note: 'First release of the eleven-question form.' },
  ],
};

/* Simple Health Quiz — a count, and nothing more. */
SEED.simpleQuiz = {
  version: 'v2.1',
  effective: '27 Aug 2026',
  membersScored: 640,
  source: 'Simple Quiz.docx / Functional Edits (1).docx',
  questions: 8,
  scoring: 'Eight yes/no questions. The result is a count of Yes and No answers, stored against the date it was taken.',
  progressNote: 'Fewer Yes answers over time indicates improvement.',
  constraint: 'The source defines no health status tiers and no supplement amounts for this quiz, so the console shows none. It also never creates or changes a Health Number.',
  items: [
    'Are you sleepy after meals?',
    'Do you need coffee during the day?',
    'Do you crave sweets?',
    'Are you more than 10 lbs overweight?',
    'Do you exercise but lack good muscle tone or consistent fat loss?',
    'Do you need to manage a chronic disease?',
    'Do you lose focus throughout the day?',
    'Do you suffer from painful arthritis?',
  ],
  versions: [
    { version: 'v2.1', effective: '27 Aug 2026', note: 'Current. Uses the eight client-supplied yes/no questions. The quiz remains a count and never changes the Health Number.', current: true },
    { version: 'v2.0', effective: '14 Apr 2026', note: 'Previous version. Removed the five invented status tiers and the supplement amounts. The quiz is a count.' },
    { version: 'v1.2', effective: '19 Dec 2025', note: 'Reworded three questions after member feedback.' },
    { version: 'v1.0', effective: '14 Sep 2025', note: 'First release.' },
  ],
};

/* Blood markers and the three ratios. */
SEED.markers = [
  { id: 'BM-1', name: 'Total cholesterol', unit: 'mg/dL', aliases: 'TC, Chol', low: 100, high: 320, status: 'Live' },
  { id: 'BM-2', name: 'HDL', unit: 'mg/dL', aliases: 'HDL-C', low: 20, high: 120, status: 'Live' },
  { id: 'BM-3', name: 'Triglycerides', unit: 'mg/dL', aliases: 'TG, Trig', low: 30, high: 600, status: 'Live' },
  { id: 'BM-4', name: 'Fasting glucose', unit: 'mg/dL', aliases: 'FBG', low: 50, high: 300, status: 'Live' },
  { id: 'BM-5', name: 'Fasting insulin', unit: 'µIU/mL', aliases: 'Insulin', low: 1, high: 60, status: 'Live' },
  { id: 'BM-6', name: 'Arachidonic acid', unit: '%', aliases: 'AA', low: 1, high: 30, status: 'Live' },
  { id: 'BM-7', name: 'EPA', unit: '%', aliases: 'Eicosapentaenoic acid', low: 0.1, high: 15, status: 'Live' },
  { id: 'BM-8', name: 'HbA1c', unit: '%', aliases: 'A1c', low: 3.5, high: 15, status: 'Live' },
  { id: 'BM-9', name: 'ApoB', unit: 'mg/dL', aliases: 'Apolipoprotein B', low: 30, high: 200, status: 'Draft' },
];

SEED.ratios = [
  { id: 'RT-1', name: 'TG / HDL ratio', formula: 'Triglycerides ÷ HDL', goal: 'Under 1', rounding: '2 decimal places' },
  { id: 'RT-2', name: 'AA / EPA ratio', formula: 'Arachidonic acid ÷ EPA', goal: '1.5 to 3', rounding: '2 decimal places',
    entry: 'Calculated or entered directly',
    entryNote: 'Some laboratories report only the ratio. The member screen accepts a typed AA/EPA value when AA and EPA are not both present, labels which source produced it, and the calculated value wins when both components are entered (client, 20 Aug 2026).' },
  { id: 'RT-3', name: 'HOMA-IR', formula: 'Fasting insulin × fasting glucose ÷ 405', goal: 'Under 1', rounding: '2 decimal places',
    note: 'The source states insulin × glucose ÷ 22.5 with glucose in mmol/L. This product collects glucose in mg/dL, and mg/dL = mmol/L × 18.0182, so ÷405 is the exact unit equivalent. Do not change one without the other.' },
  { id: 'RT-4', name: 'HbA1c', formula: 'Entered directly', goal: '4.9 to 5.1%', rounding: '1 decimal place' },
];

/* Supplement amounts are chosen by condition. They are never derived from how
   many markers sit outside their range — no source defines such a rule. */
SEED.doseByCondition = [
  { condition: 'No chronic disease', epa: '2.5g' },
  { condition: 'Overweight or obese, type II diabetes, coronary heart disease and similar', epa: '5g' },
  { condition: 'Chronic pain', epa: '7.5g' },
  { condition: 'Neurological disorders', epa: '10g' },
];

SEED.bodyComposition = {
  version: 'v2.2',
  effective: '03 Mar 2026',
  membersScored: 297,
  source: 'BMI formula.docx, Appendix B lookup tables',
  note: 'Body fat comes from the supplied lookup tables, one per sex. Nothing is interpolated. A blank cell in the table means that combination is not supported and the result reads "not available".',
  inputs: [
    { sex: 'Woman', fields: 'Hips, abdomen and height, each in inches', method: 'Three table constants, A + B − C' },
    { sex: 'Man', fields: 'Weight in pounds, waist and wrist in inches', method: 'One table cell, looked up by weight against waist minus wrist' },
  ],
  bmi: { formula: '703 × weight in pounds ÷ height in inches squared',
         note: 'Standard BMI is reported separately. It is not part of the body-fat table and must never be described as coming from it.' },
  versions: [
    { version: 'v2.2', effective: '03 Mar 2026', note: 'Current. Half-inch rounding on the female inputs and five-pound rounding on the male weight, matching the tables.', current: true },
    { version: 'v2.0', effective: '08 Nov 2025', note: 'Replaced an estimated formula with the supplied lookup tables.' },
  ],
};

SEED.markersMeta = {
  version: 'v3.4',
  effective: '11 Jul 2026',
  membersScored: 388,
  source: 'Dated Blood Markers tracking.pdf',
  versions: [
    { version: 'v3.4', effective: '11 Jul 2026', note: 'Current. Added HbA1c with its 4.9 to 5.1% goal.', current: true },
    { version: 'v3.3', effective: '20 Mar 2026', note: 'Stated the HOMA-IR unit conversion in the definition so ÷405 is not mistaken for a different formula.' },
    { version: 'v3.0', effective: '14 Sep 2025', note: 'First release with the three ratios.' },
  ],
};

/* The Assessments & Scoring index. */
SEED.assessments = [
  { id: 'AS-1', key: 'health-number', name: 'Health Number', icon: 'gauge',
    desc: 'The twelve onboarding questions, their weights and the four result bands.',
    version: 'v4.4', updated: '10 Sep 2026', members: 1284, warn: false },
  { id: 'AS-2', key: 'simple-quiz', name: 'Simple Health Quiz', icon: 'clipboard',
    desc: 'Eight yes/no questions counted and stored by date. No score, no tiers.',
    version: 'v2.1', updated: '27 Aug 2026', members: 640, warn: false },
  /* Renamed from "Health Status Report" (client, 20 Aug 2026). The stored key
     and the source document name are unchanged. */
  { id: 'AS-3', key: 'status-report', name: 'Health Assessment', icon: 'flask',
    desc: 'Eleven questions totalling 11 to 33, with six inflammation bands.',
    version: 'v1.7', updated: '28 Aug 2026', members: 412, warn: false },
  { id: 'AS-4', key: 'markers', name: 'Blood markers and ratios', icon: 'droplet',
    desc: 'Marker definitions, units, entry bounds and the four calculated ratios.',
    version: 'v3.4', updated: '11 Jul 2026', members: 388, warn: false },
  { id: 'AS-5', key: 'body-composition', name: 'BMI and body composition', icon: 'scale',
    desc: 'The supplied body-fat lookup tables per sex, and standard BMI reported separately.',
    version: 'v2.2', updated: '03 Mar 2026', members: 297, warn: false },
];

/* ---------------------------------------------------------------- nutrition -- */
/* ---------------------------------------------------------- the food library --
   THE TAXONOMY IS THE MEMBER PRODUCT'S, NOT THIS CONSOLE'S.

   Every portal, group label and food name below was read out of
   `build/dashboard.html` — the FOOD_CATEGORIES object and FC_ORDER that render
   the member's Food Choices screen — and not retyped. Four portals in the
   member's own order, fourteen groups with the member's own labels, 161 foods.

   What that means for anyone editing this file:

   - A food's classification IS its portal plus its group. There is no separate
     favorable/unfavorable flag, because three of the four portals do not work
     that way: Proteins and Fats run Best / Fair / Poor, and only carbohydrates
     split favorable from unfavorable. A binary field flattened that and put
     sweet potato among the favorable carbohydrates, where the member's own
     screen has it under Unfavorable → Starchy Vegetables.
   - `tier` is the source's own value and is deliberately NOT unique inside a
     portal — all four Unfavorable groups carry `poor`. The unique key is
     `group`, built from the portal key and the group label.
   - `memberInfo` is the exact paragraph the member reads at the top of that
     portal. Editing it in the console changes what they read.
   - `origin: 'source'` means the name came from that list. `origin: 'admin'`
     means an administrator created it, and the console labels it as such — a
     food the member's list does not contain must never look canonical.
   - `usage` is invented, like every figure in this prototype. It is derived
     from the record id so it stays the same between reloads.
   - `aliases` and `diets` are administrative, not source data. The consumer
     list carries names only; aliases exist so the Food Diary can match what a
     member typed, and are blank wherever nobody has entered one.

   Regenerating: the values come from `build/dashboard.html`, which is read-only.
   Read it; do not reconstruct this table from memory. */

/* tierInfo is the member-facing definition of the tiers, shown behind the
   (i) control on each portal (client info-button texts, 20 Aug 2026). */
SEED.foodPortals = [
  { key: 'proteins', label: 'Proteins',
    tierInfo: 'BEST protein choices are low in fat or have healthy fats and are not processed or minimally processed. FAIR protein choices have a higher amount of saturated fat and/or are minimally processed. LIMIT protein choices have high fat and/or are ultra processed.',
    memberInfo: 'Proteins help preserve lean mass, support satiety, and stabilize energy. Favor minimally processed protein sources and balance portions across your day.',
    groups: [
      { key: 'proteins:best', tier: 'best', label: 'Best' },
      { key: 'proteins:fair', tier: 'fair', label: 'Fair' },
      { key: 'proteins:poor', tier: 'poor', label: 'Limit' },
    ] },
  { key: 'fats', label: 'Fats',
    tierInfo: 'BEST choices are Omega 9 (neutral) and mostly monounsaturated. FAIR choices are Omega 9 (neutral) and saturated. LIMIT them from your diet.',
    memberInfo: 'Healthy fats support hormones, brain function, and long-lasting energy. Prioritize whole-food fats and avoid heavily refined industrial oils when possible.',
    groups: [
      { key: 'fats:best-monounsaturated-omega-9', tier: 'best', label: 'Best — Monounsaturated (Omega-9)' },
      { key: 'fats:fair-saturated-omega-9', tier: 'fair', label: 'Fair — Saturated Omega-9' },
      { key: 'fats:poor-pro-inflammatory-omega-6', tier: 'poor', label: 'Limit — Pro-inflammatory Omega-6' },
      /* New tier (client, 20 Aug 2026): "For Fats there needs to be 4
         categories: BEST, FAIR, LIMIT and AVOID." */
      { key: 'fats:avoid', tier: 'avoid', label: 'Avoid' },
    ] },
  { key: 'favorable_carbs', label: 'Favorable Carbohydrates',
    tierInfo: 'Three stars are super favorable foods and great for gut health. They can be eaten in unlimited quantities raw or cooked. Two stars are very favorable and great for gut health. You can have 3-5 cups per meal, more than most people eat at a time. BEST are great for gut health, and you can eat 1 - 1.5 cups per meal. FAIR are mostly fruits, are still good for you, and can be eaten in moderation.',
    memberInfo: 'Favorable carbohydrates are generally fiber-rich and less disruptive to glucose control. Choose whole-food carbs with nutrients and slower digestion.',
    groups: [
      { key: 'favorable_carbs:super-favorable-unlimited', tier: 'super', label: 'Super Favorable (unlimited)' },
      { key: 'favorable_carbs:very-favorable-4-6-cups-per-meal', tier: 'very', label: 'Very Favorable (4–6 cups per meal)' },
      { key: 'favorable_carbs:favorable-legumes', tier: 'best', label: 'Favorable Legumes' },
      { key: 'favorable_carbs:favorable-fruits-portions-per-meal', tier: 'fair', label: 'Favorable Fruits (portions per meal)' },
    ] },
  { key: 'unfavorable_carbs', label: 'Unfavorable Carbohydrates',
    tierInfo: 'Unfavorable carbohydrates enter the bloodstream quickly as sugar, cause a rapid rise in insulin, and increase inflammation. Eat in moderation.',
    memberInfo: 'Unfavorable carbohydrates are often rapidly absorbed and low in nutrient density. Keeping these occasional can help improve metabolic consistency.',
    groups: [
      { key: 'unfavorable_carbs:starchy-vegetables', tier: 'poor', label: 'Starchy Vegetables' },
      { key: 'unfavorable_carbs:grains-breads-incl-whole-grain', tier: 'poor', label: 'Grains & Breads (incl. "whole grain")' },
      { key: 'unfavorable_carbs:unfavorable-fruits-juices', tier: 'poor', label: 'Unfavorable Fruits / Juices' },
      { key: 'unfavorable_carbs:sugars-alcohol-sweeteners', tier: 'poor', label: 'Sugars, Alcohol & Sweeteners' },
    ] },
];

SEED.foods = [
  { id: 'FD-001', name: 'Egg whites', portal: 'proteins', group: 'proteins:best', aliases: 'egg white, eggwhite', diets: '', status: 'Live', usage: 227, origin: 'source', note: '' },
  { id: 'FD-002', name: 'Egg beaters', portal: 'proteins', group: 'proteins:best', aliases: '', diets: '', status: 'Live', usage: 228, origin: 'source', note: '' },
  { id: 'FD-003', name: 'Chicken breast, skinless', portal: 'proteins', group: 'proteins:best', aliases: '', diets: '', status: 'Live', usage: 229, origin: 'source', note: '' },
  { id: 'FD-004', name: 'Turkey breast, skinless', portal: 'proteins', group: 'proteins:best', aliases: '', diets: '', status: 'Live', usage: 230, origin: 'source', note: '' },
  { id: 'FD-005', name: 'Ground turkey', portal: 'proteins', group: 'proteins:best', aliases: '', diets: '', status: 'Live', usage: 231, origin: 'source', note: '' },
  { id: 'FD-006', name: 'Fish', portal: 'proteins', group: 'proteins:best', aliases: 'salmon, sockeye, cod, tuna, white fish', diets: '', status: 'Live', usage: 232, origin: 'source', note: '' },
  { id: 'FD-007', name: 'Tofu (firm/extra firm)', portal: 'proteins', group: 'proteins:best', aliases: '', diets: '', status: 'Live', usage: 233, origin: 'source', note: '' },
  { id: 'FD-008', name: 'Cottage cheese', portal: 'proteins', group: 'proteins:best', aliases: 'cottage', diets: '', status: 'Live', usage: 234, origin: 'source', note: '' },
  { id: 'FD-009', name: 'Soy burgers/dogs/sausage', portal: 'proteins', group: 'proteins:best', aliases: '', diets: '', status: 'Live', usage: 235, origin: 'source', note: '' },
  { id: 'FD-010', name: 'Protein powder', portal: 'proteins', group: 'proteins:best', aliases: 'protein shake, whey, protein smoothie', diets: '', status: 'Live', usage: 257, origin: 'source', note: '' },
  { id: 'FD-011', name: 'Beef (free range/game)', portal: 'proteins', group: 'proteins:best', aliases: '', diets: '', status: 'Live', usage: 258, origin: 'source', note: '' },
  { id: 'FD-012', name: 'Whole eggs', portal: 'proteins', group: 'proteins:fair', aliases: '', diets: '', status: 'Live', usage: 139, origin: 'source', note: '' },
  { id: 'FD-013', name: 'Beef (lean cuts/ground)', portal: 'proteins', group: 'proteins:fair', aliases: '', diets: '', status: 'Live', usage: 140, origin: 'source', note: '' },
  { id: 'FD-014', name: 'Canadian bacon (lean)', portal: 'proteins', group: 'proteins:fair', aliases: '', diets: '', status: 'Live', usage: 141, origin: 'source', note: '' },
  { id: 'FD-015', name: 'Chicken/turkey dark meat', portal: 'proteins', group: 'proteins:fair', aliases: '', diets: '', status: 'Live', usage: 142, origin: 'source', note: '' },
  { id: 'FD-016', name: 'Duck', portal: 'proteins', group: 'proteins:fair', aliases: '', diets: '', status: 'Live', usage: 143, origin: 'source', note: '' },
  { id: 'FD-017', name: 'Ham (lean)', portal: 'proteins', group: 'proteins:fair', aliases: '', diets: '', status: 'Live', usage: 144, origin: 'source', note: '' },
  { id: 'FD-018', name: 'Lamb (lean)', portal: 'proteins', group: 'proteins:fair', aliases: '', diets: '', status: 'Live', usage: 145, origin: 'source', note: '' },
  { id: 'FD-019', name: 'Pork (lean)', portal: 'proteins', group: 'proteins:fair', aliases: '', diets: '', status: 'Live', usage: 146, origin: 'source', note: '' },
  { id: 'FD-020', name: 'Turkey bacon', portal: 'proteins', group: 'proteins:fair', aliases: '', diets: '', status: 'Live', usage: 168, origin: 'source', note: '' },
  { id: 'FD-021', name: 'Low-fat cheese', portal: 'proteins', group: 'proteins:fair', aliases: '', diets: '', status: 'Live', usage: 169, origin: 'source', note: '' },
  { id: 'FD-022', name: 'Mozzarella (skim)', portal: 'proteins', group: 'proteins:fair', aliases: '', diets: '', status: 'Live', usage: 170, origin: 'source', note: '' },
  { id: 'FD-023', name: 'Ricotta (skim)', portal: 'proteins', group: 'proteins:fair', aliases: '', diets: '', status: 'Live', usage: 171, origin: 'source', note: '' },
  { id: 'FD-024', name: 'Hard or full-fat cheese', portal: 'proteins', group: 'proteins:fair', aliases: '', diets: '', status: 'Live', usage: 172, origin: 'source', note: '' },
  { id: 'FD-025', name: 'Pork/beef bacon', portal: 'proteins', group: 'proteins:poor', aliases: '', diets: '', status: 'Live', usage: 53, origin: 'source', note: '' },
  { id: 'FD-026', name: 'Fatty cuts of beef', portal: 'proteins', group: 'proteins:poor', aliases: '', diets: '', status: 'Live', usage: 54, origin: 'source', note: '' },
  { id: 'FD-027', name: 'Hot dogs', portal: 'proteins', group: 'proteins:poor', aliases: '', diets: '', status: 'Live', usage: 55, origin: 'source', note: '' },
  { id: 'FD-028', name: 'Kielbasa', portal: 'proteins', group: 'proteins:poor', aliases: '', diets: '', status: 'Live', usage: 56, origin: 'source', note: '' },
  { id: 'FD-029', name: 'Liver (beef/chicken)', portal: 'proteins', group: 'proteins:poor', aliases: '', diets: '', status: 'Live', usage: 57, origin: 'source', note: '' },
  { id: 'FD-030', name: 'Pepperoni', portal: 'proteins', group: 'proteins:poor', aliases: '', diets: '', status: 'Live', usage: 79, origin: 'source', note: '' },
  { id: 'FD-031', name: 'Salami', portal: 'proteins', group: 'proteins:poor', aliases: '', diets: '', status: 'Live', usage: 80, origin: 'source', note: '' },
  { id: 'FD-032', name: 'Sausage', portal: 'proteins', group: 'proteins:poor', aliases: '', diets: '', status: 'Live', usage: 81, origin: 'source', note: '' },
  { id: 'FD-033', name: 'Extra virgin olive oil', portal: 'fats', group: 'fats:best-monounsaturated-omega-9', aliases: 'EVOO, olive oil', diets: '', status: 'Live', usage: 322, origin: 'source', note: '' },
  { id: 'FD-034', name: 'Olive oil (extra light, for cooking)', portal: 'fats', group: 'fats:best-monounsaturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 323, origin: 'source', note: '' },
  { id: 'FD-035', name: 'Avocado', portal: 'fats', group: 'fats:best-monounsaturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 324, origin: 'source', note: '' },
  { id: 'FD-036', name: 'Guacamole', portal: 'fats', group: 'fats:best-monounsaturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 325, origin: 'source', note: '' },
  { id: 'FD-037', name: 'Almond butter', portal: 'fats', group: 'fats:best-monounsaturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 326, origin: 'source', note: '' },
  { id: 'FD-038', name: 'Almonds (slivered/whole)', portal: 'fats', group: 'fats:best-monounsaturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 327, origin: 'source', note: '' },
  { id: 'FD-039', name: 'Cashews', portal: 'fats', group: 'fats:best-monounsaturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 328, origin: 'source', note: '' },
  { id: 'FD-040', name: 'Macadamia nuts', portal: 'fats', group: 'fats:best-monounsaturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 350, origin: 'source', note: '' },
  { id: 'FD-041', name: 'Olives', portal: 'fats', group: 'fats:best-monounsaturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 351, origin: 'source', note: '' },
  { id: 'FD-042', name: 'Pistachios', portal: 'fats', group: 'fats:best-monounsaturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 352, origin: 'source', note: '' },
  { id: 'FD-043', name: 'Tahini', portal: 'fats', group: 'fats:best-monounsaturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 353, origin: 'source', note: '' },
  { id: 'FD-044', name: 'Mayonnaise (regular/light)', portal: 'fats', group: 'fats:fair-saturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 234, origin: 'source', note: '' },
  { id: 'FD-045', name: 'Sesame oil', portal: 'fats', group: 'fats:fair-saturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 235, origin: 'source', note: '' },
  { id: 'FD-046', name: 'High oleic safflower oil', portal: 'fats', group: 'fats:fair-saturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 236, origin: 'source', note: '' },
  { id: 'FD-047', name: 'Walnuts', portal: 'fats', group: 'fats:fair-saturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 237, origin: 'source', note: '' },
  { id: 'FD-048', name: 'Bacon bits', portal: 'fats', group: 'fats:fair-saturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 238, origin: 'source', note: '' },
  { id: 'FD-049', name: 'Butter', portal: 'fats', group: 'fats:fair-saturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 239, origin: 'source', note: '' },
  { id: 'FD-050', name: 'Cream (half & half)', portal: 'fats', group: 'fats:fair-saturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 261, origin: 'source', note: '' },
  { id: 'FD-051', name: 'Cream cheese', portal: 'fats', group: 'fats:fair-saturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 262, origin: 'source', note: '' },
  { id: 'FD-052', name: 'Lard', portal: 'fats', group: 'fats:fair-saturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 263, origin: 'source', note: '' },
  { id: 'FD-053', name: 'Sour cream', portal: 'fats', group: 'fats:fair-saturated-omega-9', aliases: '', diets: '', status: 'Live', usage: 264, origin: 'source', note: '' },
  { id: 'FD-054', name: 'Canola oil', portal: 'fats', group: 'fats:poor-pro-inflammatory-omega-6', aliases: '', diets: '', status: 'Live', usage: 145, origin: 'source', note: '' },
  { id: 'FD-055', name: 'Peanut oil', portal: 'fats', group: 'fats:poor-pro-inflammatory-omega-6', aliases: '', diets: '', status: 'Live', usage: 146, origin: 'source', note: '' },
  { id: 'FD-056', name: 'Soybean oil', portal: 'fats', group: 'fats:poor-pro-inflammatory-omega-6', aliases: '', diets: '', status: 'Live', usage: 147, origin: 'source', note: '' },
  { id: 'FD-057', name: 'Vegetable oils (corn/safflower)', portal: 'fats', group: 'fats:poor-pro-inflammatory-omega-6', aliases: '', diets: '', status: 'Live', usage: 148, origin: 'source', note: '' },
  { id: 'FD-058', name: 'Peanuts & peanut butter', portal: 'fats', group: 'fats:poor-pro-inflammatory-omega-6', aliases: '', diets: '', status: 'Live', usage: 149, origin: 'source', note: '' },
  { id: 'FD-059', name: 'Alfalfa sprouts', portal: 'favorable_carbs', group: 'favorable_carbs:super-favorable-unlimited', aliases: '', diets: '', status: 'Live', usage: 590, origin: 'source', note: '' },
  { id: 'FD-060', name: 'Bean sprouts', portal: 'favorable_carbs', group: 'favorable_carbs:super-favorable-unlimited', aliases: '', diets: '', status: 'Live', usage: 612, origin: 'source', note: '' },
  { id: 'FD-061', name: 'Bamboo shoots', portal: 'favorable_carbs', group: 'favorable_carbs:super-favorable-unlimited', aliases: '', diets: '', status: 'Live', usage: 613, origin: 'source', note: '' },
  { id: 'FD-062', name: 'Bok choy', portal: 'favorable_carbs', group: 'favorable_carbs:super-favorable-unlimited', aliases: '', diets: '', status: 'Live', usage: 614, origin: 'source', note: '' },
  { id: 'FD-063', name: 'Broccoli', portal: 'favorable_carbs', group: 'favorable_carbs:super-favorable-unlimited', aliases: '', diets: '', status: 'Live', usage: 615, origin: 'source', note: '' },
  { id: 'FD-064', name: 'Cabbage', portal: 'favorable_carbs', group: 'favorable_carbs:super-favorable-unlimited', aliases: '', diets: '', status: 'Live', usage: 616, origin: 'source', note: '' },
  { id: 'FD-065', name: 'Cauliflower', portal: 'favorable_carbs', group: 'favorable_carbs:super-favorable-unlimited', aliases: '', diets: '', status: 'Live', usage: 617, origin: 'source', note: '' },
  { id: 'FD-066', name: 'Endive', portal: 'favorable_carbs', group: 'favorable_carbs:super-favorable-unlimited', aliases: '', diets: '', status: 'Live', usage: 618, origin: 'source', note: '' },
  { id: 'FD-067', name: 'Escarole', portal: 'favorable_carbs', group: 'favorable_carbs:super-favorable-unlimited', aliases: '', diets: '', status: 'Live', usage: 619, origin: 'source', note: '' },
  { id: 'FD-068', name: 'Lettuce', portal: 'favorable_carbs', group: 'favorable_carbs:super-favorable-unlimited', aliases: '', diets: '', status: 'Live', usage: 620, origin: 'source', note: '' },
  { id: 'FD-069', name: 'Mushrooms', portal: 'favorable_carbs', group: 'favorable_carbs:super-favorable-unlimited', aliases: '', diets: '', status: 'Live', usage: 621, origin: 'source', note: '' },
  { id: 'FD-070', name: 'Spinach', portal: 'favorable_carbs', group: 'favorable_carbs:super-favorable-unlimited', aliases: '', diets: '', status: 'Live', usage: 643, origin: 'source', note: '' },
  { id: 'FD-071', name: 'Turnip greens', portal: 'favorable_carbs', group: 'favorable_carbs:super-favorable-unlimited', aliases: '', diets: '', status: 'Live', usage: 644, origin: 'source', note: '' },
  { id: 'FD-072', name: 'Artichoke', portal: 'favorable_carbs', group: 'favorable_carbs:very-favorable-4-6-cups-per-meal', aliases: '', diets: '', status: 'Live', usage: 105, origin: 'source', note: '' },
  { id: 'FD-073', name: 'Artichoke hearts', portal: 'favorable_carbs', group: 'favorable_carbs:very-favorable-4-6-cups-per-meal', aliases: '', diets: '', status: 'Live', usage: 106, origin: 'source', note: '' },
  { id: 'FD-074', name: 'Asparagus', portal: 'favorable_carbs', group: 'favorable_carbs:very-favorable-4-6-cups-per-meal', aliases: '', diets: '', status: 'Live', usage: 107, origin: 'source', note: '' },
  { id: 'FD-075', name: 'Celery', portal: 'favorable_carbs', group: 'favorable_carbs:very-favorable-4-6-cups-per-meal', aliases: '', diets: '', status: 'Live', usage: 108, origin: 'source', note: '' },
  { id: 'FD-076', name: 'Cucumber', portal: 'favorable_carbs', group: 'favorable_carbs:very-favorable-4-6-cups-per-meal', aliases: '', diets: '', status: 'Live', usage: 109, origin: 'source', note: '' },
  { id: 'FD-077', name: 'Eggplant', portal: 'favorable_carbs', group: 'favorable_carbs:very-favorable-4-6-cups-per-meal', aliases: '', diets: '', status: 'Live', usage: 110, origin: 'source', note: '' },
  { id: 'FD-078', name: 'Green/wax beans', portal: 'favorable_carbs', group: 'favorable_carbs:very-favorable-4-6-cups-per-meal', aliases: '', diets: '', status: 'Live', usage: 111, origin: 'source', note: '' },
  { id: 'FD-079', name: 'Kale', portal: 'favorable_carbs', group: 'favorable_carbs:very-favorable-4-6-cups-per-meal', aliases: '', diets: '', status: 'Live', usage: 112, origin: 'source', note: '' },
  { id: 'FD-080', name: 'Onions', portal: 'favorable_carbs', group: 'favorable_carbs:very-favorable-4-6-cups-per-meal', aliases: '', diets: '', status: 'Live', usage: 134, origin: 'source', note: '' },
  { id: 'FD-081', name: 'Peppers', portal: 'favorable_carbs', group: 'favorable_carbs:very-favorable-4-6-cups-per-meal', aliases: '', diets: '', status: 'Live', usage: 135, origin: 'source', note: '' },
  { id: 'FD-082', name: 'Snow peas', portal: 'favorable_carbs', group: 'favorable_carbs:very-favorable-4-6-cups-per-meal', aliases: '', diets: '', status: 'Live', usage: 136, origin: 'source', note: '' },
  { id: 'FD-083', name: 'Tomatoes', portal: 'favorable_carbs', group: 'favorable_carbs:very-favorable-4-6-cups-per-meal', aliases: '', diets: '', status: 'Live', usage: 137, origin: 'source', note: '' },
  { id: 'FD-084', name: 'Zucchini', portal: 'favorable_carbs', group: 'favorable_carbs:very-favorable-4-6-cups-per-meal', aliases: '', diets: '', status: 'Live', usage: 138, origin: 'source', note: '' },
  { id: 'FD-085', name: 'Hummus', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-legumes', aliases: '', diets: '', status: 'Live', usage: 479, origin: 'source', note: '' },
  { id: 'FD-086', name: 'Black beans', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-legumes', aliases: '', diets: '', status: 'Live', usage: 480, origin: 'source', note: '' },
  { id: 'FD-087', name: 'Chickpeas', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-legumes', aliases: 'chick peas, chick pea, garbanzo', diets: '', status: 'Live', usage: 481, origin: 'source', note: '' },
  { id: 'FD-088', name: 'Kidney beans', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-legumes', aliases: '', diets: '', status: 'Live', usage: 482, origin: 'source', note: '' },
  { id: 'FD-089', name: 'Lentils', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-legumes', aliases: 'dal, dhal, pulses, red lentils', diets: '', status: 'Live', usage: 483, origin: 'source', note: '' },
  { id: 'FD-090', name: 'Salsa', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-legumes', aliases: '', diets: '', status: 'Live', usage: 505, origin: 'source', note: '' },
  { id: 'FD-091', name: 'Apple', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-fruits-portions-per-meal', aliases: '', diets: '', status: 'Live', usage: 386, origin: 'source', note: '' },
  { id: 'FD-092', name: 'Applesauce', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-fruits-portions-per-meal', aliases: '', diets: '', status: 'Live', usage: 387, origin: 'source', note: '' },
  { id: 'FD-093', name: 'Apricots', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-fruits-portions-per-meal', aliases: '', diets: '', status: 'Live', usage: 388, origin: 'source', note: '' },
  { id: 'FD-094', name: 'Blueberries', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-fruits-portions-per-meal', aliases: '', diets: '', status: 'Live', usage: 389, origin: 'source', note: '' },
  { id: 'FD-095', name: 'Cantaloupe / Honeydew', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-fruits-portions-per-meal', aliases: 'Cantaloupe, Honeydew', diets: '', status: 'Live', usage: 390, origin: 'source', note: '' },
  { id: 'FD-096', name: 'Cherries', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-fruits-portions-per-meal', aliases: '', diets: '', status: 'Live', usage: 391, origin: 'source', note: '' },
  { id: 'FD-097', name: 'Grapes', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-fruits-portions-per-meal', aliases: '', diets: '', status: 'Live', usage: 12, origin: 'source', note: '' },
  { id: 'FD-098', name: 'Grapefruit', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-fruits-portions-per-meal', aliases: '', diets: '', status: 'Live', usage: 13, origin: 'source', note: '' },
  { id: 'FD-099', name: 'Kiwi', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-fruits-portions-per-meal', aliases: '', diets: '', status: 'Live', usage: 14, origin: 'source', note: '' },
  { id: 'FD-100', name: 'Nectarine', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-fruits-portions-per-meal', aliases: '', diets: '', status: 'Live', usage: 307, origin: 'source', note: '' },
  { id: 'FD-101', name: 'Orange', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-fruits-portions-per-meal', aliases: '', diets: '', status: 'Live', usage: 308, origin: 'source', note: '' },
  { id: 'FD-102', name: 'Peach', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-fruits-portions-per-meal', aliases: '', diets: '', status: 'Live', usage: 309, origin: 'source', note: '' },
  { id: 'FD-103', name: 'Pear', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-fruits-portions-per-meal', aliases: '', diets: '', status: 'Live', usage: 310, origin: 'source', note: '' },
  { id: 'FD-104', name: 'Pineapple', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-fruits-portions-per-meal', aliases: '', diets: '', status: 'Live', usage: 311, origin: 'source', note: '' },
  { id: 'FD-105', name: 'Plum', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-fruits-portions-per-meal', aliases: '', diets: '', status: 'Live', usage: 312, origin: 'source', note: '' },
  { id: 'FD-106', name: 'Raspberries', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-fruits-portions-per-meal', aliases: '', diets: '', status: 'Live', usage: 313, origin: 'source', note: '' },
  { id: 'FD-107', name: 'Strawberries', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-fruits-portions-per-meal', aliases: '', diets: '', status: 'Live', usage: 314, origin: 'source', note: '' },
  { id: 'FD-108', name: 'Tangerine', portal: 'favorable_carbs', group: 'favorable_carbs:favorable-fruits-portions-per-meal', aliases: '', diets: '', status: 'Live', usage: 315, origin: 'source', note: '' },
  { id: 'FD-109', name: 'Acorn squash', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:starchy-vegetables', aliases: '', diets: '', status: 'Live', usage: 236, origin: 'source', note: '' },
  { id: 'FD-110', name: 'Baked beans', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:starchy-vegetables', aliases: '', diets: '', status: 'Live', usage: 18, origin: 'source', note: '' },
  { id: 'FD-111', name: 'Beets', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:starchy-vegetables', aliases: '', diets: '', status: 'Live', usage: 19, origin: 'source', note: '' },
  { id: 'FD-112', name: 'Butternut squash', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:starchy-vegetables', aliases: '', diets: '', status: 'Live', usage: 20, origin: 'source', note: '' },
  { id: 'FD-113', name: 'Carrots', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:starchy-vegetables', aliases: '', diets: '', status: 'Live', usage: 21, origin: 'source', note: '' },
  { id: 'FD-114', name: 'Corn', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:starchy-vegetables', aliases: '', diets: '', status: 'Live', usage: 22, origin: 'source', note: '' },
  { id: 'FD-115', name: 'French fries', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:starchy-vegetables', aliases: '', diets: '', status: 'Live', usage: 23, origin: 'source', note: '' },
  { id: 'FD-116', name: 'Lima beans', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:starchy-vegetables', aliases: '', diets: '', status: 'Live', usage: 24, origin: 'source', note: '' },
  { id: 'FD-117', name: 'Parsnips', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:starchy-vegetables', aliases: '', diets: '', status: 'Live', usage: 25, origin: 'source', note: '' },
  { id: 'FD-118', name: 'Peas', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:starchy-vegetables', aliases: '', diets: '', status: 'Live', usage: 26, origin: 'source', note: '' },
  { id: 'FD-119', name: 'Pinto beans', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:starchy-vegetables', aliases: '', diets: '', status: 'Live', usage: 27, origin: 'source', note: '' },
  { id: 'FD-120', name: 'Potatoes', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:starchy-vegetables', aliases: '', diets: '', status: 'Live', usage: 49, origin: 'source', note: '' },
  { id: 'FD-121', name: 'Refried beans', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:starchy-vegetables', aliases: '', diets: '', status: 'Live', usage: 50, origin: 'source', note: '' },
  { id: 'FD-122', name: 'Sweet potatoes', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:starchy-vegetables', aliases: 'sweet potato, kumara, yam', diets: '', status: 'Live', usage: 51, origin: 'source', note: '' },
  { id: 'FD-123', name: 'Bagels', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: '', diets: '', status: 'Live', usage: 52, origin: 'source', note: '' },
  { id: 'FD-124', name: 'Biscuits', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: '', diets: '', status: 'Live', usage: 53, origin: 'source', note: '' },
  { id: 'FD-125', name: 'Bread', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: 'white bread, toast, sourdough, wholemeal', diets: '', status: 'Live', usage: 54, origin: 'source', note: '' },
  { id: 'FD-126', name: 'Buckwheat', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: '', diets: '', status: 'Live', usage: 55, origin: 'source', note: '' },
  { id: 'FD-127', name: 'Cereal & granola', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: 'cereal, breakfast cereal, muesli', diets: '', status: 'Live', usage: 56, origin: 'source', note: '' },
  { id: 'FD-128', name: 'Cornbread', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: '', diets: '', status: 'Live', usage: 57, origin: 'source', note: '' },
  { id: 'FD-129', name: 'Couscous', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: '', diets: '', status: 'Live', usage: 58, origin: 'source', note: '' },
  { id: 'FD-130', name: 'Crackers', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: '', diets: '', status: 'Live', usage: 80, origin: 'source', note: '' },
  { id: 'FD-131', name: 'Croissants / Doughnuts', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: 'Croissants, Doughnuts', diets: '', status: 'Live', usage: 81, origin: 'source', note: '' },
  { id: 'FD-132', name: 'Grits', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: '', diets: '', status: 'Live', usage: 82, origin: 'source', note: '' },
  { id: 'FD-133', name: 'Muffins', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: '', diets: '', status: 'Live', usage: 83, origin: 'source', note: '' },
  { id: 'FD-134', name: 'Pancakes / Waffles', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: 'Pancakes, Waffles', diets: '', status: 'Live', usage: 84, origin: 'source', note: '' },
  { id: 'FD-135', name: 'Pasta', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: '', diets: '', status: 'Live', usage: 85, origin: 'source', note: '' },
  { id: 'FD-136', name: 'Popcorn', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: '', diets: '', status: 'Live', usage: 86, origin: 'source', note: '' },
  { id: 'FD-137', name: 'Pretzels', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: '', diets: '', status: 'Live', usage: 87, origin: 'source', note: '' },
  { id: 'FD-138', name: 'Quinoa', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: '', diets: '', status: 'Live', usage: 88, origin: 'source', note: '' },
  { id: 'FD-139', name: 'Rice / Rice cakes', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: 'Rice, Rice cakes', diets: '', status: 'Live', usage: 89, origin: 'source', note: '' },
  { id: 'FD-140', name: 'Tortillas / Tortilla chips', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: 'Tortillas, Tortilla chips', diets: '', status: 'Live', usage: 111, origin: 'source', note: '' },
  { id: 'FD-141', name: 'Bananas', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:unfavorable-fruits-juices', aliases: '', diets: '', status: 'Live', usage: 112, origin: 'source', note: '' },
  { id: 'FD-142', name: 'Cranberries', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:unfavorable-fruits-juices', aliases: '', diets: '', status: 'Live', usage: 113, origin: 'source', note: '' },
  { id: 'FD-143', name: 'Dried fruit (raisins, prunes…)', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:unfavorable-fruits-juices', aliases: '', diets: '', status: 'Live', usage: 114, origin: 'source', note: '' },
  { id: 'FD-144', name: 'Figs', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:unfavorable-fruits-juices', aliases: '', diets: '', status: 'Live', usage: 115, origin: 'source', note: '' },
  { id: 'FD-145', name: 'Guava', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:unfavorable-fruits-juices', aliases: '', diets: '', status: 'Live', usage: 116, origin: 'source', note: '' },
  { id: 'FD-146', name: 'Mango', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:unfavorable-fruits-juices', aliases: '', diets: '', status: 'Live', usage: 117, origin: 'source', note: '' },
  { id: 'FD-147', name: 'Papaya', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:unfavorable-fruits-juices', aliases: '', diets: '', status: 'Live', usage: 118, origin: 'source', note: '' },
  { id: 'FD-148', name: 'Fruit juice', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:unfavorable-fruits-juices', aliases: 'orange juice, oj, apple juice', diets: '', status: 'Live', usage: 119, origin: 'source', note: '' },
  { id: 'FD-149', name: 'Vegetable juice', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:unfavorable-fruits-juices', aliases: '', diets: '', status: 'Live', usage: 120, origin: 'source', note: '' },
  { id: 'FD-150', name: 'Sugary drinks', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:sugars-alcohol-sweeteners', aliases: 'soft drink, soda, pop, cola', diets: '', status: 'Live', usage: 142, origin: 'source', note: '' },
  { id: 'FD-151', name: 'Candy', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:sugars-alcohol-sweeteners', aliases: '', diets: '', status: 'Live', usage: 143, origin: 'source', note: '' },
  { id: 'FD-152', name: 'Cake / Cookies / Baked goods', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:sugars-alcohol-sweeteners', aliases: 'Cake, Cookies, Baked goods', diets: '', status: 'Live', usage: 144, origin: 'source', note: '' },
  { id: 'FD-153', name: 'Honey', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:sugars-alcohol-sweeteners', aliases: '', diets: '', status: 'Live', usage: 145, origin: 'source', note: '' },
  { id: 'FD-154', name: 'Jam / Jelly', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:sugars-alcohol-sweeteners', aliases: 'Jam, Jelly', diets: '', status: 'Live', usage: 146, origin: 'source', note: '' },
  { id: 'FD-155', name: 'Ketchup / Cocktail sauce', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:sugars-alcohol-sweeteners', aliases: 'Ketchup, Cocktail sauce', diets: '', status: 'Live', usage: 147, origin: 'source', note: '' },
  { id: 'FD-156', name: 'Molasses', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:sugars-alcohol-sweeteners', aliases: '', diets: '', status: 'Live', usage: 148, origin: 'source', note: '' },
  { id: 'FD-157', name: 'Sugar', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:sugars-alcohol-sweeteners', aliases: '', diets: '', status: 'Live', usage: 149, origin: 'source', note: '' },
  { id: 'FD-158', name: 'Teriyaki sauce', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:sugars-alcohol-sweeteners', aliases: '', diets: '', status: 'Live', usage: 150, origin: 'source', note: '' },
  { id: 'FD-159', name: 'Wine', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:sugars-alcohol-sweeteners', aliases: '', diets: '', status: 'Live', usage: 151, origin: 'source', note: '' },
  { id: 'FD-160', name: 'Beer', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:sugars-alcohol-sweeteners', aliases: '', diets: '', status: 'Live', usage: 173, origin: 'source', note: '' },
  { id: 'FD-161', name: 'Alcohol', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:sugars-alcohol-sweeteners', aliases: '', diets: '', status: 'Live', usage: 174, origin: 'source', note: '' },
  { id: 'FD-A01', name: 'Wild salmon', portal: 'proteins', group: 'proteins:best', aliases: 'salmon fillet, sockeye', diets: 'Pescatarian, Omnivore', status: 'Live', usage: 104, origin: 'admin', note: 'Added here to name one fish specifically. The consumer list carries the general “Fish”, in this same group.' },
  { id: 'FD-A02', name: 'Greek yoghurt', portal: 'proteins', group: 'proteins:fair', aliases: 'greek yogurt, yoghurt', diets: 'Vegetarian', status: 'Live', usage: 105, origin: 'admin', note: 'Not on the consumer list. An administrator placed it in Fair; that placement is an administrative decision, not a source value.' },
  { id: 'FD-A03', name: 'Oat milk', portal: 'unfavorable_carbs', group: 'unfavorable_carbs:grains-breads-incl-whole-grain', aliases: 'oatmilk, oat milk latte', diets: 'Vegan, Vegetarian', status: 'Review', usage: 106, origin: 'admin', note: 'Created from the custom-food queue and still under review. Not on the consumer list.' },
  /* The Avoid tier foods (client, 20 Aug 2026). */
  { id: 'FD-165', name: 'Trans fats', portal: 'fats', group: 'fats:avoid', aliases: 'trans fat', diets: '', status: 'Live', usage: 0, origin: 'source', note: '' },
  { id: 'FD-166', name: 'Vegetable shortening', portal: 'fats', group: 'fats:avoid', aliases: 'shortening', diets: '', status: 'Live', usage: 0, origin: 'source', note: '' },
  { id: 'FD-167', name: 'Hydrogenated oils', portal: 'fats', group: 'fats:avoid', aliases: 'hydrogenated oil', diets: '', status: 'Live', usage: 0, origin: 'source', note: '' },
  { id: 'FD-168', name: 'Partially hydrogenated oils', portal: 'fats', group: 'fats:avoid', aliases: 'partially hydrogenated oil', diets: '', status: 'Live', usage: 0, origin: 'source', note: '' },
];

/* The reconciliation queue: what members typed into the Food Diary that no name
   and no alias in the catalogue matched. Admin-only — nothing here is on the
   member's Food Choices screen until somebody promotes it into the catalogue. */
SEED.customFoods = [
  { id: 'CF-1', entered: 'chick pea salad', count: 14, members: 9,  suggestion: 'Match to Chickpeas — Favorable Carbohydrates, Favorable Legumes' },
  { id: 'CF-2', entered: 'quinoa bowl',     count: 22, members: 17, suggestion: 'Match to Quinoa — Unfavorable Carbohydrates, Grains & Breads' },
  { id: 'CF-3', entered: 'salmonn',         count: 6,  members: 5,  suggestion: 'Spelling. Match to Fish — Proteins, Best' },
  { id: 'CF-4', entered: 'kombucha',        count: 31, members: 24, suggestion: 'No match on the consumer list. Creating it makes an admin-created record' },
  { id: 'CF-5', entered: 'asdf',            count: 2,  members: 2,  suggestion: 'Not a food. Reject' },
];

SEED.mealTemplates = [
  { id: 'MT-1', name: 'Work day',                              slots: 'Breakfast, snack, exercise, brunch, dinner', diets: 'All', uses: 240, status: 'Live' },
  { id: 'MT-2', name: 'Work day with morning exercise',         slots: 'Breakfast, snack, exercise, brunch, dinner', diets: 'All', uses: 118, status: 'Live' },
  { id: 'MT-3', name: 'Work day, exercise after work',         slots: 'Breakfast, snack, brunch, exercise, dinner', diets: 'All', uses: 87,  status: 'Live' },
  { id: 'MT-4', name: 'Weekend day',                           slots: 'Breakfast, lunch, snack, dinner',             diets: 'All', uses: 61,  status: 'Live' },
  { id: 'MT-5', name: 'Weekend day with morning exercise — Option 1', slots: 'Breakfast, exercise, lunch, snack, dinner', diets: 'All', uses: 0, status: 'Live' },
  { id: 'MT-6', name: 'Weekend day with morning exercise — Option 2', slots: 'Breakfast, exercise, lunch, snack, dinner', diets: 'All', uses: 0, status: 'Live' },
];

/* Supplement guidance references retained for later clinical/content work. */
SEED.supplementGuidance = [
  { id: 'SG-1', name: 'Health Assessment EPA/DHA bands', supplement: 'Omega-3 (EPA/DHA)', trigger: 'Health Assessment total', amount: '2.5g / 5g / 7.5g by total; 10g only for neurological disorders', status: 'Draft' },
  { id: 'SG-2', name: 'Blood-marker EPA/DHA guidance', supplement: 'Omega-3 (EPA/DHA)', trigger: 'Condition-based blood-marker interpretation', amount: '2.5g optimal / 3.5g moderate / 5g high', status: 'Draft' },
  { id: 'SG-3', name: 'Polyphenol guidance', supplement: 'Polyphenols', trigger: 'Health Assessment and blood-marker guidance', amount: '500mg / 1000mg / 1500mg supplied lines', status: 'Draft' },
];

/* ---------------------------------------------------------------- companion -- */
SEED.companion = {
  enabled: true,
  name: 'Sprout',
  welcome: 'Hi, I’m Sprout. I can help you think through meals, your plan and how your week is going. What would you like to look at?',
  fallback: 'That is outside what I can help with, but your coach can pick it up. Would you like me to pass it on?',
  safeResponse: 'I can share what your plan already says, but anything about an amount or a medical question needs your coach to confirm.',
  prompts: [
    { id: 'QP-1', label: 'Plan my next day', prompt: 'Help me build tomorrow from my food choices', active: true },
    { id: 'QP-2', label: 'What should I eat now?', prompt: 'Suggest something from my favourable list', active: true },
    { id: 'QP-3', label: 'How is my week going?', prompt: 'Summarise my diary and mood for the week', active: true },
    { id: 'QP-4', label: 'Explain my Health Number', prompt: 'Explain what my Health Number means in plain language', active: true },
    { id: 'QP-5', label: 'Help me shop', prompt: 'Turn my week into a shopping list', active: false },
  ],
  topics: [
    { id: 'TP-1', label: 'Food choices and meals', allowed: true },
    { id: 'TP-2', label: 'The member’s own plan and diary', allowed: true },
    { id: 'TP-3', label: 'How Veye assessments work', allowed: true },
    { id: 'TP-4', label: 'Mood and daily check-ins', allowed: true },
    { id: 'TP-5', label: 'Supplement amounts', allowed: false, why: 'Amounts are set by condition and confirmed by a coach.' },
    { id: 'TP-6', label: 'Diagnosis, symptoms and medication', allowed: false, why: 'Always handed to a person.' },
  ],
  knowledgeSources: [
    { id: 'KS-1', title: 'Health Number guide', type: 'VEYE educational document', reference: 'Health Number guide', description: 'Plain-language explanation of the Health Number and what a lower result means.', scope: 'Health Number explanations', status: 'Active', updated: '10 Sep 2026' },
    { id: 'KS-2', title: 'Help and FAQs', type: 'FAQ / Help', reference: 'Help and FAQ content', description: 'Approved answers to common member questions about using VEYE.', scope: 'Member support questions', status: 'Active', updated: '02 Sep 2026' },
    { id: 'KS-3', title: 'Food Choices reference', type: 'Food Choices reference', reference: 'Food Choices guidance', description: 'Approved food-category wording used when members ask about their selections.', scope: 'Food Choices guidance', status: 'Inactive', updated: '28 Aug 2026' },
  ],
};

SEED.conversations = [
  { id: 'CV-1', memberId: 'HM-001817', member: 'Lena Ortiz', at: '14 Aug 2026, 04:52', flagged: true, reviewed: false,
    why: 'Held because the reply combined two supplements without a coach confirming it.',
    feedback: { rating: 'not-helpful', comment: 'I needed a clearer next step instead of general information.', submittedAt: '14 Aug 2026, 05:10', reviewed: false },
    messages: [
      { who: 'member', text: 'I started taking magnesium at night. Is that OK with the omega-3 you suggested?' },
      { who: 'sprout', text: 'Those are usually taken at different times of day. Magnesium in the evening and omega-3 with a meal is a common pattern.', held: true },
    ] },
  { id: 'CV-2', memberId: 'HM-000992', member: 'Robert Williams', at: '13 Aug 2026, 22:10', flagged: true, reviewed: false,
    why: 'Held because the member described sustained difficulty. Policy is to hand this to a person.',
    feedback: { rating: null, comment: null, submittedAt: null, reviewed: false },
    messages: [
      { who: 'member', text: 'I haven’t slept properly in a week and I feel like nothing is working.' },
      { who: 'sprout', text: 'That sounds really hard. Would it help to look at your evening routine together?', held: true },
    ] },
  { id: 'CV-3', memberId: 'HM-002118', member: 'Daniel Kim', at: '13 Aug 2026, 12:40', flagged: true, reviewed: true,
    why: 'Reviewed on 13 August. Sprout gave the safe answer and did not name an amount.',
    feedback: { rating: 'helpful', comment: 'Thank you — that explained why I need to check with my coach.', submittedAt: '13 Aug 2026, 13:02', reviewed: true },
    messages: [
      { who: 'member', text: 'How much EPA should I take each day?' },
      { who: 'sprout', text: 'I can share what your plan lists, but a specific amount needs your coach to confirm.' },
    ] },
  { id: 'CV-4', memberId: 'HM-002402', member: 'Aisha Bello', at: '13 Aug 2026, 08:15', flagged: false, reviewed: true,
    why: '',
    feedback: { rating: null, comment: null, submittedAt: null, reviewed: false },
    messages: [
      { who: 'member', text: 'Can you build me a day around salmon and sweet potato?' },
      /* Sweet potato is under Unfavorable Carbohydrates → Starchy Vegetables on
         the member's own Food Choices screen, so Sprout cannot call it
         favourable. Two parts of the console must not disagree about the same
         food. */
      { who: 'sprout', text: 'Yes. Fish sits under Proteins → Best, so salmon at dinner is a good anchor. Sweet potatoes are under Unfavorable Carbohydrates → Starchy Vegetables, so I have kept them to one portion and filled the rest of the day from Super Favorable — broccoli and spinach, which are unlimited.' },
      { who: 'member', text: 'That works, thank you.' },
    ] },
  { id: 'CV-5', memberId: 'HM-001238', member: 'Cara Morgan', at: '12 Aug 2026, 19:22', flagged: false, reviewed: true,
    why: '',
    feedback: { rating: null, comment: null, submittedAt: null, reviewed: false },
    messages: [
      { who: 'member', text: 'What does my Health Number actually measure?' },
      { who: 'sprout', text: 'It comes from twelve questions about how you eat, move and sleep. A lower number is better. Yours moved from 4.0 to 3.5 at your last check-in.' },
    ] },
  { id: 'CV-6', memberId: 'HM-001556', member: 'Sophie Patel', at: '12 Aug 2026, 19:05', flagged: false, reviewed: true,
    why: '',
    feedback: { rating: null, comment: null, submittedAt: null, reviewed: false },
    messages: [
      { who: 'member', text: 'What do you think about the new phone that came out?' },
      { who: 'sprout', text: 'That is outside what I can help with, but I am here for anything about your plan.' },
    ] },
];

/* ------------------------------------------------------------------ content -- */
SEED.website = [
  { id: 'WS-01', section: 'Announcement bar', where: 'Every public page', status: 'Live', updated: '13 Aug 2026',
    fields: [{ label: 'Message', value: 'August programmes are open. Start your Health Number in under five minutes.', type: 'text' },
             { label: 'Link label', value: 'Start now', type: 'short' },
             { label: 'Link destination', value: 'onboarding.html', type: 'short' }] },
  { id: 'WS-02', section: 'Home hero', where: 'Home page', status: 'Live', updated: '14 Jul 2026',
    fields: [{ label: 'Heading', value: 'Nutrition Reimagined', type: 'short' },
             { label: 'Supporting copy', value: 'Find your Health Number, understand what it means, and change it with food you actually like.', type: 'text' },
             { label: 'Primary call to action', value: 'Start the process', type: 'short' }] },
  { id: 'WS-03', section: 'How it works', where: 'Home page', status: 'Live', updated: '02 Jul 2026',
    fields: [{ label: 'Step one', value: 'Answer twelve questions', type: 'short' },
             { label: 'Step two', value: 'Get your Health Number', type: 'short' },
             { label: 'Step three', value: 'Choose the foods you like', type: 'short' },
             { label: 'Step four', value: 'Follow your days', type: 'short' }] },
  { id: 'WS-04', section: 'Why Veye', where: 'Why Veye page', status: 'Live', updated: '14 Jul 2026',
    fields: [{ label: 'Heading', value: 'Why Veye works', type: 'short' },
             { label: 'Supporting copy', value: 'Veye is built on food, not restriction. The programme is designed around what you already eat.', type: 'text' }] },
  { id: 'WS-05', section: 'Pricing copy', where: 'Pricing page', status: 'Draft', updated: '14 Aug 2026',
    fields: [{ label: 'DIY summary', value: 'Everything you need to run the programme yourself.', type: 'text' },
             { label: 'Guided summary', value: 'DIY, plus a coach who knows your plan.', type: 'text' }] },
  { id: 'WS-06', section: 'Help and FAQ', where: 'Help page', status: 'Live', updated: '02 Jun 2026',
    fields: [{ label: 'Intro', value: 'Most questions are answered here. If not, we usually reply the same day.', type: 'text' },
             { label: 'Top question', value: 'How is my Health Number calculated?', type: 'short' }] },
  { id: 'WS-07', section: 'Community call to action', where: 'Home page', status: 'Live', updated: '21 Jun 2026',
    fields: [{ label: 'Heading', value: 'You are not doing this alone', type: 'short' },
             { label: 'Button label', value: 'Join the wait list', type: 'short' }] },
];

SEED.dashboardContent = [
  { id: 'DC-01', kind: 'Daily tip', title: 'Front-load your protein', body: 'Getting protein into the first meal of the day steadies what you reach for later.', audience: 'Everyone', status: 'Live', updated: '05 Aug 2026' },
  { id: 'DC-02', kind: 'Daily tip', title: 'Colour before quantity', body: 'Two colours on the plate does more than a smaller portion of one.', audience: 'Everyone', status: 'Live', updated: '01 Aug 2026' },
  { id: 'DC-03', kind: 'Personal tip', title: 'Your evening wind-down', body: 'You have answered No to sleeping well three times. A fixed wind-down half hour is the change most people start with.', audience: 'Answered No to sleeping well', status: 'Live', updated: '05 Aug 2026' },
  { id: 'DC-04', kind: 'Personal tip', title: 'Hydration reminder', body: 'Your diary shows most days start without a drink. A glass before coffee is an easy first change.', audience: 'Diary shows no morning drink', status: 'Live', updated: '30 Jul 2026' },
  { id: 'DC-05', kind: 'Feature card', title: 'Food Choices', body: 'Pick the proteins, vegetables, fats and carbohydrates you actually like.', audience: 'Everyone', status: 'Live', updated: '18 Jul 2026' },
  { id: 'DC-06', kind: 'Feature card', title: 'Mood Tracker', body: 'One tap a day builds a picture of your month.', audience: 'Everyone', status: 'Live', updated: '18 Jul 2026' },
  /* These were "Coming soon" labels while the sections were locked. The
     sections are live now, so the label each one shows is the development
     notice (client wording, 20 Aug 2026). */
  { id: 'DC-07', kind: 'Section reference', title: 'Supplements', body: 'Phase 2 reference — content and clinical review remain outside this Beta.', audience: 'Everyone', status: 'Phase 2', updated: '12 Sep 2026' },
  { id: 'DC-08', kind: 'Section reference', title: 'Resources', body: 'Phase 2 reference — publishing remains outside this Beta.', audience: 'Everyone', status: 'Phase 2', updated: '12 Sep 2026' },
  { id: 'DC-09', kind: 'Section reference', title: 'Fitness', body: 'Phase 2 reference — final workout content and media remain deferred.', audience: 'Everyone', status: 'Phase 2', updated: '12 Sep 2026' },
  { id: 'DC-10', kind: 'Section notice', title: 'Mindfulness', body: 'In Development.', audience: 'Everyone', status: 'Live', updated: '20 Aug 2026' },
  { id: 'DC-11', kind: 'Help content', title: 'How your Health Number works', body: 'Twelve questions, each carrying a weight. A lower number is better. You can retake it every six months.', audience: 'Everyone', status: 'Live', updated: '02 Jun 2026' },
];

/* Resource drafts, waiting for their member cards to open. */
SEED.resources = [
  { id: 'RS-06', title: 'Why mornings set the day', kind: 'Article', updated: '12 Jun 2026', status: 'Draft' },
  { id: 'RS-09', title: 'Reading a food label', kind: 'Article', updated: '28 May 2026', status: 'Draft' },
  { id: 'RS-14', title: 'Understanding inflammation', kind: 'Article', updated: '12 Aug 2026', status: 'Draft' },
  { id: 'RS-21', title: 'Ten-minute mobility', kind: 'Video', updated: '22 Jul 2026', status: 'Draft' },
  { id: 'RS-22', title: 'Shopping the outside aisles', kind: 'Download', updated: '19 Jul 2026', status: 'Draft' },
];

SEED.notices = [
  { id: 'NO-01', title: 'August programmes are open', body: 'Guided places for August are open until the 22nd.', channel: 'In-app', audience: 'Everyone', status: 'Active', updated: '13 Aug 2026' },
  { id: 'NO-02', title: 'Planned maintenance on Sunday', body: 'Veye will be unavailable between 02:00 and 04:00 Pacific on Sunday 17 August.', channel: 'In-app', audience: 'Everyone', status: 'Scheduled', updated: '12 Aug 2026' },
  { id: 'NO-03', title: 'Finish your onboarding', body: 'You are part-way through. It takes about four minutes to finish.', channel: 'Email', audience: 'Onboarding incomplete', status: 'Active', updated: '11 Aug 2026' },
  { id: 'NO-04', title: 'Your blood results are ready', body: 'Your coach has looked at the markers you submitted.', channel: 'Email', audience: 'Rule driven', status: 'Active', updated: '02 Aug 2026' },
  { id: 'NO-05', title: 'Refer a friend', body: 'Share Veye with someone who would enjoy it.', channel: 'In-app', audience: 'High adherence', status: 'Draft', updated: '09 Aug 2026' },
  { id: 'NO-06', title: 'Spring reset 2026', body: 'The spring reset starts on 1 March.', channel: 'Email', audience: 'Everyone', status: 'Inactive', updated: '04 Mar 2026' },
];

SEED.legalDocs = [
  { id: 'LD-1', title: 'Terms and Conditions', category: 'Terms', version: 'v4.0', effective: '01 Apr 2026', state: 'Published',
    accepted: 1238, of: 1284, updated: '01 Apr 2026',
    body: 'PROTOTYPE CONTENT — NOT LEGAL TEXT.\n\nThese terms describe the agreement between a member and Veye Health, Inc. covering account creation, acceptable use, subscription and cancellation, the limits of the service, and how disputes are handled.\n\nThe wording that ships to members must be drafted and approved by counsel. This placeholder exists so the console can demonstrate versioning, publishing and re-acceptance.',
    history: [
      { version: 'v3.2', effective: '12 Feb 2026', note: 'Added the annual plan and its cancellation terms.' },
      { version: 'v3.0', effective: '14 Sep 2025', note: 'First public release.' },
    ] },
  { id: 'LD-2', title: 'Privacy Policy', category: 'Privacy', version: 'v3.2', effective: '01 Apr 2026', state: 'Published',
    accepted: 1238, of: 1284, updated: '01 Apr 2026',
    body: 'PROTOTYPE CONTENT — NOT LEGAL TEXT.\n\nThis policy describes what personal data Veye collects, why it is collected, how long it is kept, who it is shared with, and the choices a member has over it.\n\nThe wording that ships to members must be drafted and approved by counsel.',
    history: [{ version: 'v3.1', effective: '12 Feb 2026', note: 'Named the email delivery provider.' }] },
  { id: 'LD-3', title: 'Health Data Notice', category: 'Consent', version: 'v2.1', effective: '12 Feb 2026', state: 'Published',
    accepted: 1201, of: 1284, updated: '12 Feb 2026',
    body: 'PROTOTYPE CONTENT — NOT LEGAL TEXT.\n\nThis notice describes the health information a member gives Veye — assessment answers, blood marker values, body measurements, mood entries and food diary entries — what it is used for, and how a member withdraws it.\n\nThe wording that ships to members must be drafted and approved by counsel.',
    history: [{ version: 'v2.0', effective: '14 Sep 2025', note: 'First release.' }] },
  { id: 'LD-4', title: 'Companion and AI Notice', category: 'Consent', version: 'v1.4 draft', effective: 'Not set', state: 'Draft',
    accepted: 1144, of: 1284, updated: '13 Aug 2026',
    body: 'PROTOTYPE CONTENT — NOT LEGAL TEXT.\n\nThis notice explains that Veye Companion generates its replies automatically, that some replies are held for a person to read before the member sees them, that conversations are stored against the member record, and that Companion does not diagnose, treat or prevent any condition.\n\nThe wording that ships to members must be drafted and approved by counsel.',
    history: [{ version: 'v1.3', effective: '02 Jun 2026', note: 'Published. Added the held-reply explanation.' }] },
];

/* --------------------------------------------------------- plans and billing -- */
SEED.plans = [
  { id: 'PL-1', name: 'DIY', price: '$29 / month', includes: 'Dashboard, assessments and the food tools', members: 742, status: 'Live' },
  { id: 'PL-2', name: 'Guided', price: '$89 / month', includes: 'Everything in DIY, plus a coach and programmes', members: 386, status: 'Live' },
  { id: 'PL-3', name: 'Trial', price: 'Free for 14 days', includes: 'Onboarding and the Health Number', members: 156, status: 'Live' },
  { id: 'PL-4', name: 'Guided Annual', price: '$890 / year', includes: 'Guided, billed once a year', members: 0, status: 'Draft' },
];

SEED.billing = {
  plan: 'Veye Business',
  seats: 11,
  seatsUsed: 10,
  renews: '04 Jan 2027',
  method: 'Card ending 4242',
  contact: 'elena.fischer@veye.example',
  invoices: [
    { id: 'IV-2608', date: '01 Aug 2026', amount: '$1,320.00', period: 'August 2026', status: 'Paid' },
    { id: 'IV-2607', date: '01 Jul 2026', amount: '$1,320.00', period: 'July 2026', status: 'Paid' },
    { id: 'IV-2606', date: '01 Jun 2026', amount: '$1,200.00', period: 'June 2026', status: 'Paid' },
  ],
};

SEED.integrations = [
  { id: 'IG-1', name: 'Laboratory results feed', kind: 'Health data', status: 'Attention', lastSync: '13 Aug 2026, 23:10', detail: 'Two rows were rejected on the last run because the HDL unit was not recognised.' },
  { id: 'IG-2', name: 'Email delivery', kind: 'Communication', status: 'Connected', lastSync: '14 Aug 2026, 08:00', detail: 'Sending member emails and notices.' },
  { id: 'IG-3', name: 'Payment processor', kind: 'Billing', status: 'Connected', lastSync: '14 Aug 2026, 07:45', detail: 'Subscriptions, renewals and refunds.' },
  { id: 'IG-4', name: 'Wearable activity', kind: 'Health data', status: 'Not connected', lastSync: '—', detail: 'Would bring in step and activity data. Not set up.' },
];

/* -------------------------------------------------- member feature releases --
   Every feature is member-visible; the development sections carry their own
   in-product notice while their content is written. */
SEED.features = [
  { id: 'FT-01', name: 'Dashboard', desc: 'The member home screen.', state: 'Live', enabled: true, locked: false },
  { id: 'FT-02', name: 'Onboarding and Health Number', desc: 'The twelve questions and the result.', state: 'Live', enabled: true, locked: false },
  /* The four portals the member actually has. The old wording here named a
     taxonomy that never existed on their screen. */
  { id: 'FT-03', name: 'Food Choices', desc: 'The Proteins, Fats, Favorable Carbohydrates and Unfavorable Carbohydrates portals.', state: 'Live', enabled: true, locked: false },
  { id: 'FT-04', name: 'Meal Planning', desc: 'Building and assigning days.', state: 'Live', enabled: true, locked: false },
  { id: 'FT-05', name: 'Food Diary', desc: 'Daily meal entries, time eaten, pre-meal feelings, notes, prototype macro estimates, daily summary and history.', state: 'Live', enabled: true, locked: false },
  { id: 'FT-06', name: 'Mood Tracker', desc: 'The daily mood entry and its calendar.', state: 'Live', enabled: true, locked: false },
  { id: 'FT-07', name: 'Veye Companion', desc: 'Sprout, the in-product companion.', state: 'Live', enabled: true, locked: false },
  { id: 'FT-08', name: 'Blood markers', desc: 'Marker entry and the calculated ratios.', state: 'Live', enabled: true, locked: false },
  { id: 'FT-09', name: 'Activity Tracker', desc: 'Shown without a connected data source.', state: 'Live', enabled: true, locked: false },
/* These consumer areas are retained as Phase 2 references. They are neither
   live member experiences nor operational management surfaces in this Beta. */
  { id: 'FT-10', name: 'Supplements', desc: 'Phase 2 reference — content and clinical review remain outside this Beta.', state: 'Phase 2', enabled: false, locked: true },
  { id: 'FT-11', name: 'Resources', desc: 'Phase 2 reference — publishing experience remains outside this Beta.', state: 'Phase 2', enabled: false, locked: true },
  { id: 'FT-12', name: 'Fitness', desc: 'Phase 2 reference — final workout content and media remain deferred.', state: 'Phase 2', enabled: false, locked: true },
  { id: 'FT-13', name: 'Mindfulness', desc: 'A polished In Development destination between Fitness and Resources.', state: 'Live', enabled: true, locked: false },
];

/* Only Mindfulness has a simple Beta notice. The other named areas are kept as
   Phase 2 references, not editable member content. */
SEED.memberSections = {
  supplements: {
    devNote: 'Supplements — this section is being developed. For now, Veye offers some important information.',
    lede: 'While you cannot fix a macronutrient issue with micronutrients, with an anti-inflammation diet supplements can enhance your health.',
    otherTitle: 'Individual vitamin pros and cons',
    otherProvisional: 'Provisional educational content supplied by the Veye team — pending citation and clinical review.',
    otherNote: 'The Other Supplements button opens the client-supplied Vitamin Overview. The text is managed as one supplied document; edits here change what members read.',
  },
  fitness: {
    devNote: 'Content in development.',
    links: [
      { id: 'FL-1', label: 'Interested in Martial Arts and Boxing?', sub: 'Veye recommends the EYR system.', url: 'https://withme.so/EngageYourRage' },
      { id: 'FL-2', label: 'Here are 5 exercises to avoid', sub: 'Watch on YouTube.', url: 'https://youtu.be/XLlHJ5-vHWw' },
      { id: 'FL-3', label: 'Need to improve your range of motion?', sub: 'Veye recommends the NeoRomX system — watch on YouTube.', url: 'https://youtu.be/7YLttuiwGvw' },
    ],
    embedNote: 'The current member screen is a static visual preview, not a working video player. Real playback begins only after final video assets and permissions are supplied.',
  },
  mindfulness: {
    devNote: 'In Development',
    /* Only the development status is client-supplied — no future scope is
       described until Cara defines it. */
    body: 'Under development — more coming.',
  },
  resources: {
    devNote: 'Resources are in development.',
    cards: [
      { id: 'RC-1', order: 1, title: 'Blogs', status: 'Coming Soon',
        desc: 'Veye contributors comment on a number of factors related to wellness. Read our regularly updated articles and view the videos that interest you. Not seeing what interests you? Let us know and we will create a post with your interests in mind.' },
      { id: 'RC-2', order: 2, title: 'Lifestyle', status: 'Coming Soon',
        desc: 'Explore media that focuses on daily living, personal interests, and hobbies. Veye topics include fashion, food, travel, wellness, plastic surgery, and even home decor. Want recipes, cooking tips, and tips for dining out? We have that, too.' },
      { id: 'RC-3', order: 3, title: 'Articles', status: 'Coming Soon',
        desc: 'Research papers, excerpts, and articles giving you insight to the science behind the Veye program. Want academic or accessible, expert content or beginner guides, advanced research or quick reads? Veye has it all.' },
      { id: 'RC-4', order: 4, title: 'Biohacks', status: 'Coming Soon',
        desc: 'Interested in making intentional changes to your exercise routine, lifestyle, or environment to optimize your physical and mental performance? Often called "do-it-yourself biology", Biohacks use science, data, and self-experimentation to take a proactive role in health and longevity. Discover Veye offerings and recommendations.' },
    ],
  },
};

/* ------------------------------------------------------- where does it appear --
   The one question this console could not answer before: does what I change
   here reach a member, or does it only tell me something?

   Three effects, and every row is exactly one of them:

     control     an edit changes copy, availability, scoring, content or a plan
                 that a member or a visitor sees
     view        derived from member activity; reading it changes nothing
     admin       affects administrators or administration only

   Rendered by a "Where does this appear?" control in the page header, so the
   answer is one click away on the screen it concerns rather than a paragraph on
   every screen. The full audit is in
   docs/qa/prototype-client/ADMIN_TO_CONSUMER_CONTROL_MAP.md. */
SEED.whereShown = {
  home: { title: 'Home', lede: 'Home reports. It changes almost nothing.', rows: [
    ['The four figures, the trend and the health line', 'view', 'Counted from member activity. Reading Home changes nothing a member sees.'],
    ['Needs attention', 'view', 'A working queue for the Veye team. Members are never told they are on it.'],
    ['Add a member', 'control', 'Starts a real member journey: the person is invited and completes onboarding themselves.'],
    ['Edit website content', 'control', 'Opens the public website copy.'],
    ['Review Companion messages', 'admin', 'Opens staff review. A held reply stays held until somebody sends it.'],
  ] },

  members: { title: 'Members and Member 360', lede: 'A record of what members did. Two controls change their experience.', rows: [
    ['Every directory column', 'view', 'Signup, plan, onboarding, assessment and usage data.'],
    ['Storyline', 'view', 'A read-only chronology of member actions and staff interventions.'],
    ['Assessments tab', 'view', 'The same Health Number, Simple Health Quiz, Health Assessment, markers and body composition the member sees on their dashboard.'],
    ['Assign a plan', 'control', 'Changes the program and the days the member is shown.'],
    ['Message', 'control', 'A real message into the member’s Companion thread.'],
    ['Internal note', 'admin', 'Team-only. It appears on the storyline and never to the member.'],
  ] },

  care: { title: 'Care Studio', lede: 'The most consumer-facing screen in the console.', rows: [
    ['Programs and member plans', 'control', 'The plan and the days a member follows.'],
    ['Food Library — portals and groups', 'control', 'The four portals on the member’s Food Choices screen and the groups inside them.'],
    ['Portal description', 'control', 'The paragraph a member reads at the top of that portal.'],
    ['Custom foods', 'admin', 'A reconciliation queue. Nothing here reaches Food Choices until it is matched or promoted.'],
    ['Meal templates', 'control', 'Feed Meal Planning. The slots fill from the member’s own selected foods.'],
    ['Development sections — Mindfulness', 'control', 'A simple in-development notice shown to members. Supplements and Fitness remain Phase 2 references.'],
  ] },

  assessments: { title: 'Assessments & Scoring', lede: 'Definitions, not results. Editing one changes what every member is asked and told.', rows: [
    ['Questions and options', 'control', 'The wording a member reads during the assessment.'],
    ['Weights and bands', 'control', 'The number and the band a member is given.'],
    ['Band wording', 'control', 'The sentence a member reads with their result.'],
    ['Version history', 'admin', 'Results already stored keep the version that produced them.'],
    ['The canonical logic', 'admin', 'Held in the member product’s own veye-calculations.js. The console displays and edits source-backed definitions; it does not invent a second formula.'],
  ] },

  companion: { title: 'Companion', lede: 'Settings shape Sprout. Conversations are review.', rows: [
    ['Availability, opening line, quick prompts', 'control', 'What a member sees when they open Sprout.'],
    ['Allowed topics, safe response, fallback', 'control', 'What Sprout will and will not answer.'],
    ['Knowledge Sources', 'control', 'Approved product-level source metadata: title, type, scope, status and last update. No files, indexing or provider settings.'],
    ['Conversations', 'view', 'Review. Reading one changes nothing.'],
    ['Member feedback', 'admin', 'Read a member’s helpful/not-helpful response and mark existing feedback reviewed.'],
  ] },

  content: { title: 'Content', lede: 'Almost everything here is read by somebody outside the console.', rows: [
    ['Website', 'control', 'Public website copy — anyone can read it, signed in or not.'],
    ['Dashboard Content', 'control', 'Member tips, personal suggestions, the Companion entry wording and dashboard promotions.'],
    ['Notifications', 'control', 'The notice templates members receive, and who receives them.'],
    ['Legal Documents', 'control', 'Terms and Privacy, their effective versions, and whether members are asked to accept again.'],
    ['Resources & Media', 'control', 'The four member resource cards (Blogs, Lifestyle, Articles, Biohacks), their descriptions, order and Coming Soon status.'],
  ] },

  insights: { title: 'Insights', lede: 'Analysis only. Nothing on this screen writes anything.', rows: [
    ['Every chart and figure', 'view', 'Counted from member activity. It describes the group and never an individual.'],
    ['Date range and series', 'admin', 'Changes what you are looking at, not what anybody has.'],
    ['Export', 'admin', 'A file for the Veye team. Nothing leaves the browser in this prototype.'],
  ] },

  settings: { title: 'Settings', lede: 'Two of these five reach members.', rows: [
    ['Organization', 'control', 'The name, logo and support details used in member communications and documents.'],
    ['Plans & Billing', 'control', 'Public pricing and what members are told their plan includes.'],
    ['Administrators', 'admin', 'Invites another administrator with the same access. There are no roles.'],
    ['Integrations', 'admin', 'Data-source configuration and status.'],
    ['Feature Availability', 'control', 'Whether a Beta feature appears to members. Supplements, Fitness and Resources remain Phase 2 references.'],
  ] },

  profile: { title: 'Your profile', lede: 'Entirely your own. None of it reaches a member.', rows: [
    ['Name, email, phone, timezone', 'admin', 'Your name appears on changes you make and messages you send. It does not change any member’s identity.'],
    ['Notifications', 'admin', 'When the console emails you. Not member notifications — those are in Content.'],
    ['Security and sessions', 'admin', 'Your own sign-in only.'],
    ['Display', 'admin', 'How this console is drawn for you, in this browser.'],
  ] },
};

/* ------------------------------------------------------------ recent activity --
   Plain language. A short record of what changed, not a governance ledger. */
SEED.activity = [
  { id: 'RA-1', who: 'Cara Hogue',   what: 'Updated the announcement bar', when: '13 Aug 2026, 17:40' },
  { id: 'RA-2', who: 'Priya Shah',   what: 'Added ApoB to the blood marker list as a draft', when: '13 Aug 2026, 14:12' },
  { id: 'RA-3', who: 'Nina Alvarez', what: 'Edited the daily tip “Front-load your protein”', when: '13 Aug 2026, 11:05' },
  { id: 'RA-4', who: 'Tom Becker',   what: 'Marked a Companion conversation reviewed', when: '13 Aug 2026, 09:22' },
  { id: 'RA-5', who: 'Maya Patel',   what: 'Created the Longevity Nutrition Plan draft', when: '12 Aug 2026, 16:48' },
  { id: 'RA-6', who: 'Elena Fischer', what: 'Invited Jonah Reid as an administrator', when: '12 Aug 2026, 10:30' },
];

/* ----------------------------------------------------------------- insights -- */
SEED.insights = {
  members: {
    total: 1284, active: 1109, paused: 96, lapsed: 79,
    joined: [64, 71, 58, 83, 96, 88, 104, 121, 112, 97, 118, 126],
    months: ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
    funnel: [
      { step: 'Started onboarding', n: 1642 },
      { step: 'Answered the twelve questions', n: 1401 },
      { step: 'Received a Health Number', n: 1284 },
      { step: 'Chose their foods', n: 1046 },
      { step: 'Built a first day', n: 812 },
    ],
    bySubscription: [
      { label: 'DIY', n: 742 }, { label: 'Guided', n: 386 }, { label: 'Trial', n: 156 },
    ],
  },
  engagement: {
    weekly: [58, 61, 60, 64, 67, 66, 70, 72, 71, 74, 76, 78],
    dau: 412, wau: 861, diaryEntries: 5820, moodEntries: 7431, companionChats: 2214,
    surfaces: [
      { label: 'Food Choices', n: 3120 },
      { label: 'Mood Tracker', n: 2740 },
      { label: 'Food Diary', n: 2380 },
      { label: 'Companion', n: 2214 },
      { label: 'Meal Planning', n: 1890 },
      { label: 'Blood markers', n: 640 },
    ],
  },
  health: {
    /* A lower Health Number is better, so this distribution reads left to right
       from best to worst. */
    distribution: [
      { band: 'Good Health', range: '0 to 1', n: 148 },
      { band: 'Relatively Good Health', range: '1.5 to 3.5', n: 462 },
      { band: 'Moderately Good Health', range: '4 to 6', n: 481 },
      { band: 'Insulin Resistance Risk', range: '6.5 to 10', n: 193 },
    ],
    averageByMonth: [4.9, 4.8, 4.8, 4.7, 4.6, 4.6, 4.5, 4.4, 4.4, 4.3, 4.2, 4.2],
    retakes: 318,
    improved: 211, unchanged: 74, worsened: 33,
    programCompletion: [
      { name: 'Stabilize Your Day', members: 214, completion: 68 },
      { name: 'Steady Mornings', members: 168, completion: 74 },
      { name: 'Nutrition Reset', members: 96, completion: 55 },
      { name: 'Movement Foundations', members: 41, completion: 32 },
    ],
  },
  operations: {
    openItems: 10, resolvedThisWeek: 34, medianFirstLook: '3h 20m',
    byKind: [
      { label: 'Onboarding', n: 2 }, { label: 'Blood markers', n: 1 },
      { label: 'Companion', n: 1 }, { label: 'Mood', n: 1 },
      { label: 'Plan', n: 1 }, { label: 'Message', n: 1 },
      { label: 'Billing', n: 1 }, { label: 'Assessment', n: 1 }, { label: 'System', n: 1 },
    ],
    weeklyResolved: [22, 27, 25, 31, 28, 34, 30, 36, 33, 29, 35, 34],
    integrations: 4, integrationsHealthy: 2,
  },
};

/* ---------------------------------------------------------- member detail ----
   Explicit records for four members, and a deterministic generator for the rest
   so every member profile is populated without inventing a different shape.
   Nothing here is random: the generator is seeded from the member id. */

const DETAIL = {
  'HM-001238': {
    biomarkers: [
      { date: '14 Aug 2026', tc: 196, hdl: 58, tg: 104, glucose: 92, insulin: 7.4, aa: 9.2, epa: 3.1, hba1c: 5.2,
        ratioResults: [{ name: 'TG / HDL ratio', value: 1.79, goal: 'Under 1', status: 'Outside goal' }, { name: 'AA / EPA ratio', value: 2.97, goal: '1.5 to 3', status: 'Inside goal' }, { name: 'HOMA-IR', value: 1.68, goal: 'Under 1', status: 'Outside goal' }, { name: 'HbA1c', value: 5.2, goal: '4.9 to 5.1%', status: 'Outside goal' }] },
      { date: '02 Mar 2026', tc: 208, hdl: 54, tg: 141, glucose: 96, insulin: 9.1, aa: 11.4, epa: 2.4, hba1c: 5.4,
        ratioResults: [{ name: 'TG / HDL ratio', value: 2.61, goal: 'Under 1', status: 'Outside goal' }, { name: 'AA / EPA ratio', value: 4.75, goal: '1.5 to 3', status: 'Outside goal' }, { name: 'HOMA-IR', value: 2.16, goal: 'Under 1', status: 'Outside goal' }, { name: 'HbA1c', value: 5.4, goal: '4.9 to 5.1%', status: 'Outside goal' }] },
    ],
    mood: [4, 4, 3, 5, 4, 4, 5, 3, 4, 5, 5, 4, 4, 3, 4, 5, 4, 4, 5, 5, 4, 3, 4, 4, 5, 4, 4, 5],
    quiz: [{ date: '10 Aug 2026', yes: 2, no: 6 }, { date: '02 Jun 2026', yes: 4, no: 4 }],
    hsr: [{ date: '02 Aug 2026', total: 27 }, { date: '12 Feb 2026', total: 23 }],
    body: { sex: 'Woman', height: 65, weight: 148, hips: 39, abdomen: 31, bodyFat: 26.6, bmi: 24.6, date: '02 Aug 2026' },
    hnHistory: [{ date: '02 Aug 2026', score: 3.5 }, { date: '02 May 2026', score: 4.0 }, { date: '12 Feb 2026', score: 4.5 }],
    storyline: [
      { at: '14 Aug 2026, 06:40', kind: 'health', text: 'Submitted six blood markers.' },
      { at: '12 Aug 2026, 19:22', kind: 'companion', text: 'Asked Companion what the Health Number measures.' },
      { at: '10 Aug 2026, 08:02', kind: 'assessment', text: 'Completed the Simple Health Quiz. 2 Yes, 6 No.' },
      { at: '02 Aug 2026, 07:15', kind: 'assessment', text: 'Retook the Health Number. 3.5, down from 4.0.' },
      { at: '28 Jul 2026, 20:10', kind: 'care', text: 'Finished week 6 of Stabilize Your Day.' },
      { at: '12 Feb 2026, 09:00', kind: 'account', text: 'Joined Veye on the DIY plan.' },
    ],
  },
  'HM-000992': {
    biomarkers: [
      { date: '04 Aug 2026', tc: 244, hdl: 38, tg: 218, glucose: 112, insulin: 18.2, aa: 14.8, epa: 1.9, hba1c: 5.9,
        ratioResults: [{ name: 'TG / HDL ratio', value: 5.74, goal: 'Under 1', status: 'Outside goal' }, { name: 'AA / EPA ratio', value: 7.79, goal: '1.5 to 3', status: 'Outside goal' }, { name: 'HOMA-IR', value: 5.03, goal: 'Under 1', status: 'Outside goal' }, { name: 'HbA1c', value: 5.9, goal: '4.9 to 5.1%', status: 'Outside goal' }] },
      { date: '11 Feb 2026', tc: 238, hdl: 40, tg: 196, glucose: 106, insulin: 15.6, aa: 13.2, epa: 2.1, hba1c: 5.7,
        ratioResults: [{ name: 'TG / HDL ratio', value: 4.9, goal: 'Under 1', status: 'Outside goal' }, { name: 'AA / EPA ratio', value: 6.29, goal: '1.5 to 3', status: 'Outside goal' }, { name: 'HOMA-IR', value: 4.08, goal: 'Under 1', status: 'Outside goal' }, { name: 'HbA1c', value: 5.7, goal: '4.9 to 5.1%', status: 'Outside goal' }] },
    ],
    mood: [2, 2, 3, 2, 1, 2, 3, 2, 2, 1, 2, 3, 3, 2, 2, 1, 1, 2, 2, 3, 2, 2, 1, 1, 1, 2, 2, 2],
    quiz: [{ date: '06 Aug 2026', yes: 6, no: 2 }, { date: '02 Apr 2026', yes: 5, no: 3 }],
    hsr: [{ date: '04 Aug 2026', total: 18 }, { date: '18 Jan 2026', total: 16 }],
    body: { sex: 'Man', height: 70, weight: 214, waist: 43, wrist: 7.5, bodyFat: 31.4, bmi: 30.7, date: '04 Aug 2026' },
    hnHistory: [{ date: '04 Aug 2026', score: 7.5 }, { date: '02 May 2026', score: 7.0 }, { date: '18 Nov 2025', score: 6.5 }],
    storyline: [
      { at: '13 Aug 2026, 22:10', kind: 'companion', text: 'Companion held a reply after the member described a difficult week.' },
      { at: '13 Aug 2026, 20:02', kind: 'life', text: 'Third low mood entry in a row, each mentioning broken sleep.' },
      { at: '06 Aug 2026, 07:40', kind: 'assessment', text: 'Completed the Simple Health Quiz. 6 Yes, 2 No.' },
      { at: '04 Aug 2026, 09:12', kind: 'health', text: 'New blood markers. TG/HDL 5.74, HOMA-IR 5.03.' },
      { at: '04 Aug 2026, 08:55', kind: 'assessment', text: 'Retook the Health Number. 7.5, up from 7.0.' },
      { at: '18 Nov 2025, 10:20', kind: 'account', text: 'Joined Veye on the Guided plan.' },
    ],
  },
  'HM-002402': {
    biomarkers: [
      { date: '01 Aug 2026', tc: 178, hdl: 71, tg: 62, glucose: 84, insulin: 4.1, aa: 6.4, epa: 3.9, hba1c: 5.0,
        ratioResults: [{ name: 'TG / HDL ratio', value: 0.87, goal: 'Under 1', status: 'Inside goal' }, { name: 'AA / EPA ratio', value: 1.64, goal: '1.5 to 3', status: 'Inside goal' }, { name: 'HOMA-IR', value: 0.85, goal: 'Under 1', status: 'Inside goal' }, { name: 'HbA1c', value: 5.0, goal: '4.9 to 5.1%', status: 'Inside goal' }] },
    ],
    mood: [5, 5, 4, 5, 5, 5, 4, 5, 5, 4, 5, 5, 5, 4, 5, 5, 5, 5, 4, 5, 5, 5, 4, 5, 5, 5, 5, 5],
    quiz: [{ date: '01 Aug 2026', yes: 1, no: 7 }],
    hsr: [{ date: '01 Aug 2026', total: 31 }],
    body: { sex: 'Woman', height: 67, weight: 139, hips: 37, abdomen: 27, bodyFat: 21.5, bmi: 21.8, date: '01 Aug 2026' },
    hnHistory: [{ date: '01 Aug 2026', score: 1.0 }, { date: '01 Jul 2026', score: 1.5 }],
    storyline: [
      { at: '13 Aug 2026, 08:15', kind: 'companion', text: 'Asked Companion to build a day around salmon and sweet potato.' },
      { at: '01 Aug 2026, 07:02', kind: 'assessment', text: 'Retook the Health Number. 1.0, down from 1.5.' },
      { at: '01 Aug 2026, 06:50', kind: 'health', text: 'First blood markers submitted. All four ratios inside their goals.' },
      { at: '01 Jul 2026, 12:00', kind: 'account', text: 'Joined Veye on the Guided plan.' },
    ],
  },
  'HM-002341': {
    biomarkers: [],
    mood: [3, 4, 3],
    quiz: [],
    hsr: [],
    body: null,
    hnHistory: [],
    storyline: [
      { at: '11 Aug 2026, 21:14', kind: 'account', text: 'Stopped at step 7 of 12, the blood marker step.' },
      { at: '10 Aug 2026, 19:30', kind: 'life', text: 'Third mood entry recorded.' },
      { at: '09 Aug 2026, 18:02', kind: 'account', text: 'Started onboarding on the Trial plan.' },
    ],
  },
};

/* Deterministic filler so every member profile is complete. Seeded from the id
   so the same member always shows the same figures. */
function seedFrom(id) {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) % 9973;
  return n;
}
function fill(member) {
  const s = seedFrom(member.id);
  const pick = (k, lo, hi) => lo + ((s * (k + 7)) % (hi - lo + 1));
  const hn = member.hn;
  const good = hn == null ? 3 : hn <= 3.5 ? 4 : hn <= 6 ? 3 : 2;
  const mood = [];
  for (let i = 0; i < 28; i++) mood.push(Math.max(1, Math.min(5, good + ((s + i * 13) % 3) - 1)));
  return {
    biomarkers: hn == null ? [] : [{
      date: member.hnTaken, tc: pick(1, 170, 240), hdl: pick(2, 38, 70), tg: pick(3, 70, 210),
      glucose: pick(4, 82, 110), insulin: pick(5, 4, 17) + 0.4, aa: pick(6, 6, 15) + 0.2,
      epa: pick(7, 1, 4) + 0.3, hba1c: 4.9 + (pick(8, 0, 9) / 10),
    }],
    mood,
    quiz: hn == null ? [] : [{ date: member.hnTaken, yes: Math.min(8, Math.max(0, Math.round((hn || 4) - 1))), no: 8 - Math.min(8, Math.max(0, Math.round((hn || 4) - 1))) }],
    hsr: hn == null ? [] : [{ date: member.hnTaken, total: Math.max(12, Math.min(33, 33 - Math.round((hn || 4) * 2.4))) }],
    body: null,
    hnHistory: hn == null ? [] : [
      { date: member.hnTaken, score: hn },
      { date: member.joined, score: Math.max(0, Math.min(10, hn - (member.hnTrend || 0))) },
    ],
    storyline: [
      { at: member.lastActive, kind: 'life', text: 'Last opened Veye.' },
      { at: member.hnTaken === '—' ? member.joined : member.hnTaken, kind: 'assessment',
        text: hn == null ? 'Onboarding is not finished, so there is no Health Number yet.' : 'Completed the Health Number. ' + hn.toFixed(1) + '.' },
      { at: member.joined, kind: 'account', text: 'Joined Veye on the ' + member.subscription + ' plan.' },
    ],
  };
}

SEED.memberDetail = {};
SEED.members.forEach((m) => { SEED.memberDetail[m.id] = DETAIL[m.id] || fill(m); });

/* Messages, per member. */
SEED.threads = [
  { id: 'TH-1', memberId: 'HM-001238', unread: 1, last: '14 Aug 2026, 07:40', messages: [
    { who: 'member', at: '14 Aug 2026, 07:40', text: 'I uploaded my results this morning — anything I should look at?' },
    { who: 'admin', at: '13 Aug 2026, 16:02', from: 'Cara Hogue', text: 'Week six looks steady. Keep the evening meal where it is.' },
  ] },
  { id: 'TH-2', memberId: 'HM-002118', unread: 1, last: '12 Aug 2026, 12:45', messages: [
    { who: 'member', at: '12 Aug 2026, 12:45', text: 'How much EPA should I take each day?' },
  ] },
  { id: 'TH-3', memberId: 'HM-000992', unread: 1, last: '13 Aug 2026, 20:02', messages: [
    { who: 'member', at: '13 Aug 2026, 20:02', text: 'Sleep has been rough this week.' },
    { who: 'admin', at: '10 Aug 2026, 09:15', from: 'James Lee', text: 'Let us look at the evening routine on Friday.' },
  ] },
  { id: 'TH-4', memberId: 'HM-001556', unread: 0, last: '09 Aug 2026, 09:12', messages: [
    { who: 'member', at: '09 Aug 2026, 09:12', text: 'Thanks, I will take a look at the plan.' },
    { who: 'admin', at: '08 Aug 2026, 14:40', from: 'Maya Patel', text: 'Nutrition Reset is assigned and ready when you are.' },
  ] },
  { id: 'TH-5', memberId: 'HM-002402', unread: 0, last: '06 Aug 2026, 10:20', messages: [
    { who: 'member', at: '06 Aug 2026, 10:20', text: 'Thanks for the plan, the mornings are much easier now.' },
  ] },
];

window.Veye = window.Veye || { screens: {} };
window.Veye.SEED = SEED;
window.Veye.TODAY_LABEL = TODAY_LABEL;

})();
