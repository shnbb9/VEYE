/* ============================================================================
   Veye Admin Console — synthetic prototype data (14 Nov 2026 edition)
   ----------------------------------------------------------------------------
   Every person, account, message and figure below is invented. Addresses are
   on demo.veye.test (members, visitors) or veye.example (the Veye team).

   WHAT THIS MIRRORS
   The real console (platform/web, app/admin/**) reads PostgreSQL. This file is
   that database for the prototype: the same rows the console's API returns,
   in the same shapes, so every screen can be a faithful copy of the console's
   own screen. Product content — the Help / FAQ answers, the Care Studio items,
   Sprout's wording and topic rules, the knowledge sources, the health-sharing
   terms and email — is the console's own seed content, copied verbatim,
   including the client's published support addresses (help@veye.co in the
   Help answers, contact@veye.co as the support email — the console's own
   defaults). Only invented people get invented addresses.

   TIME
   The console shows live dates. So does this: `buildSeed(now)` is called when
   the sample data is created (first visit, or "Reset the sample data") and
   every timestamp is an offset from that moment. Stored in localStorage, the
   data then ages exactly as a real database would.

   HEALTH RESULTS
   Stored results are written out as the scoring engine stored them — score,
   band, dose and flags as literal values, hand-checked against the canonical
   rules (HealthNumbers.xlsx bands, Health Assessment.docx bands and EPA/DHA
   boundaries, the Dated Blood Markers goals and Supplement Rec'd Under Blood
   Markers tiers). Nothing here recalculates anything.
   ============================================================================ */

(function () {

/* ---------------------------------------------------------- deterministic ids */
function fnv(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hex(str, n) {
  let out = '';
  for (let i = 0; out.length < n; i++) out += fnv(str + '#' + i).toString(16).padStart(8, '0');
  return out.slice(0, n);
}
function uuid(str) {
  const h = hex(str, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16], 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/* --------------------------------------------------------------- rich text --
   The document tree the console's editor produces and the API validates
   (app/policies/richtext.py). Never HTML. */
const txt = (text, marks = []) => ({ type: 'text', text, marks });
const paragraphs = (...lines) => ({ blocks: lines.map((line) => ({ type: 'paragraph', children: [txt(line)] })) });

/* ============================================================== CONTENT =====
   Verbatim from platform/api/app/seed/content_data.py (client-approved Help
   page copy) and care.py. */
const HELP_FAQ = [
  ['what_is_veye', 'About Veye', 'What is Veye?', 'Veye programs help members manage disease, lose weight and take a proactive role in their own healthcare. Veye takes a nutritional approach to family health. Whether challenged by diabetes, heart disease, osteoporosis, infertility, asthma or the simple desire to improve quality of life, Veye will be there to offer detailed nutritional planning and day-to-day support. Veye makes it possible to put medical advice into action.'],
  ['what_subscription_am_i_on', 'Subscription and My Account', 'What subscription am I on?', 'Create an account to see the subscription options.'],
  ['how_do_i_use_the_veye_site', 'Using the Platform', 'How do I use the Veye site?', 'The Veye site is designed to be simple and easy to use. Veye uses an internal AI assistant to guide you at your pace, concentrate on the things that work best for you, and give you personalized tips and advice. You can start with a question to the Veye Companion, randomly click on the features that interest you, or go to the left column and take the time to set up your program.'],
  ['where_should_i_start', 'Using the Platform', 'Where should I start?', 'For best results, after you sign in Veye suggests that you start by filling in the sections on the left in order. Create a baseline assessment by filling in a Progress Tracker of your choice, or filling in more than one. Try using the Mood Tracker, eventually understanding how food affects your mood.'],
  ['i_can_t_sign_in_to_my_account', 'Technical Issues', 'I can’t sign in to my account', 'Check that you are using the email address you signed up with, and that Caps Lock is off. If you are still unable to sign in, close the tab and open Veye again before trying once more.'],
  ['i_forgot_my_password', 'Technical Issues', 'I forgot my password', 'Use the show/hide control in the password field to confirm what you have typed. Password resets will be available from the sign-in screen; until then, email us and we will help you back in.'],
  ['a_page_will_not_load_or_looks_broken', 'Technical Issues', 'A page will not load or looks broken', 'Refresh the page first. If that does not help, clear your browser cache and reload. A stale cached file is the most common cause of a page rendering incorrectly.'],
  ['what_is_metabolism', 'Diet and Nutrition Terminology', 'What is metabolism?', 'Your metabolism is how you process and convert energy, and is controlled by AMPK. Metabolism controls your weight, mental focus, physical performance, how you age, and more. By following the Veye program you can control AMPK, and therefore your metabolism.'],
  ['is_intermittent_fasting_good_for_you', 'Diet and Nutrition Terminology', 'Is intermittent fasting good for you?', 'Although intermittent fasting has shown promise in reducing senescent, or “zombie” cells, you can achieve the same effect without starving by eating a low calorie diet with the proper ratio of macronutrients. The Veye program restricts calories without sacrifice.'],
  ['why_do_i_need_to_eat_protein_at_every_meal', 'Diet and Nutrition Terminology', 'Why do I need to eat protein at every meal?', 'To activate glucagon and AMPK, two important components to health.'],
  ['how_much_protein_do_i_need', 'Diet and Nutrition Terminology', 'How much protein do I need?', 'Most women need 77grams per day and men 121grams, although this varies by the individual. The Veye program can help you determine your exact protein needs.'],
  ['how_is_veye_different_from_other_diet_programs', 'About Veye', 'How is Veye different from other diet programs?', 'Veye goes far beyond what diet sites such as WW (Weight Watchers), Noom and Jenny Craig offer, and beyond what most nutritionists offer. Veye’s proprietary systems are about more than weight loss — they are about improved health. The Veye nutritional program is based on peer reviewed and published Medical research. Veye maintains relationships with medical organizations, cutting edge thinkers, and sole practitioners.'],
  ['what_is_in_my_account', 'Subscription and My Account', 'What is in My Account?', 'To recover your account, go to the sign in section, enter your email and reset your password.'],
  ['how_do_i_set_up_my_meals', 'Using the Platform', 'How do I set up my meals?', 'Then make your food choices — this will help the Veye Companion customize your meals. After you have chosen the foods you like to eat, go to Your Days and the Veye Companion will help you create meals that work around your lifestyle, not the other way around. Before you start, the Veye Companion will give you the opportunity to explore the science behind our program.'],
  ['what_should_i_do_every_day', 'Using the Platform', 'What should I do every day?', 'Finally, fill out the food diary as often as possible. The Veye Companion will assess your choices and let you know what meals are perfect for you, and what can be improved.'],
  ['my_progress_does_not_seem_to_be_saving', 'Technical Issues', 'My progress does not seem to be saving', 'Make sure you press Save on the screen you are filling in, and that your browser is not in private/incognito mode, which discards stored progress when the window closes.'],
  ['which_browsers_and_devices_does_veye_support', 'Technical Issues', 'Which browsers and devices does Veye support?', 'Veye works on current versions of Chrome, Edge, Firefox and Safari, on desktop, tablet and phone. If you are on an older browser, updating it usually resolves display problems.'],
  ['my_issue_is_still_not_fixed', 'Technical Issues', 'My issue is still not fixed', 'Email help@veye.co with a short description of what happened and which page you were on, and we will take it from there.'],
  ['what_is_the_key_to_living_longer', 'Diet and Nutrition Terminology', 'What is the key to living longer?', 'Calorie restriction is the only known way to increase longevity. The Veye program allows calorie restriction without hunger or deprivation.'],
  ['is_a_vegan_diet_the_best_one', 'Diet and Nutrition Terminology', 'Is a vegan diet the best one?', 'The research is inconclusive, although Veye respects individuals who choose this lifestyle. It is hard to get adequate protein on a vegan diet. Veye can help you maintain a vegan diet, or make healthy choices whatever your dietary preference is.'],
  ['can_you_eat_too_much_protein', 'Diet and Nutrition Terminology', 'Can you eat too much protein?', 'Yes, it is important to have the right protein prescription for you and your lifestyle. Veye will give you your protein requirement and help you maintain lean muscle mass.'],
  ['is_there_protein_in_cantaloupe_broccoli', 'Diet and Nutrition Terminology', 'Is there protein in cantaloupe, broccoli?', 'Although there may be trace amounts, there is not enough to activate glucagon or AMPK, and therefore these are not good protein sources.'],
];

const MEMBER_COPY = [
  { key: 'companion_first_visit_welcome', title: 'Companion — first visit welcome', order: 1, status: 'Archived',
    body: 'Welcome to the Veye program — I look forward to working with you. How would you like to begin? I can start with the why to — the reasons behind the program and its basics — or go straight to the how to and begin meal planning.',
    source: 'Managed in Companion → Settings (companion_settings); archived here to keep one source of truth.' },
  { key: 'companion_returning_welcome', title: 'Companion — returning welcome', order: 2, status: 'Archived',
    body: "Welcome back — I'm Sprout, your Veye companion. What would you like to work on today?",
    source: 'Managed in Companion → Settings (companion_settings); archived here to keep one source of truth.' },
  { key: 'health_assessment_parameters_note', title: 'Health Assessment — under the result', order: 3, status: 'Published',
    body: 'These parameters reflect the overall inflammation in your organs. Your goal is to keep inflammation in control — not too much or too little. Symptoms of chronic diseases are associated with chronic high inflammation.' },
  { key: 'simple_quiz_intro', title: 'Simple Quiz — introduction', order: 4, status: 'Published',
    body: '8 yes/no questions to track your progress. Best health is 8 "No" answers.' },
  { key: 'daily_health_tip', title: 'Dashboard — Daily Health tip', order: 0, status: 'Draft',
    body: 'Write the daily tip members should see on their dashboard, then publish it. The prototype\'s sample sentence ("Although you are in moderately good health…") was placeholder copy and is not shown to members.' },
  { key: 'development_section_note', title: 'Development sections — status line', order: 5, status: 'Published',
    body: 'Under development — more coming.' },
];

const CARE_SEED_BY = 'Seed (client-approved prototype content)';
const CARE_ITEMS = [
  { kind: 'fitness', title: 'Interested in Martial Arts and Boxing?', category: 'Martial Arts & Boxing', content_type: 'program',
    description: 'VEYE recommends the EYR System.', external_url: 'https://withme.so/EngageYourRage', display_order: 1, status: 'Published',
    source: 'Cara — Dashboard edits.docx (FITNESS), 17 Sep 2026' },
  { kind: 'fitness', title: 'Here are 5 exercises to avoid', category: 'Exercise guidance', content_type: 'video', description: '',
    youtube_url: 'https://youtu.be/XLlHJ5-vHWw', display_order: 2, status: 'Published',
    source: 'Cara — YouTube channel video "5 Exercises to Avoid #1" (verified 17 Sep 2026)' },
  { kind: 'fitness', title: 'Need to improve your range of motion?', category: 'Range of Motion', content_type: 'video',
    description: 'VEYE recommends the NeoRomX System.', youtube_url: 'https://youtu.be/7YLttuiwGvw', display_order: 3, status: 'Published',
    source: 'Cara — YouTube channel video "NeoRomX for increased range of motion" (verified 17 Sep 2026)' },
  { kind: 'supplement', title: 'Veye supplement information', category: 'Overview', content_type: 'copy',
    description: 'While you cannot fix a macronutrient issue with micronutrients, with an anti-inflammation diet supplements can enhance your health.',
    body: 'It is important to remember that a balanced diet is the first step to health management. Trying to undo or reverse the effects of an unbalanced diet with supplements will not work.\n\nAlthough there are a myriad of supplements that can enhance your health, Veye recommends the two most important ones: Omega 3 fatty acids DHA/EPA, and Polyphenols.\n\nThe best source of DHA/EPA are pharmaceutical grade fish oils (not just purified or molecular distilled). For vegetarians and vegans, try an algae based DHA source. Omega 3 fatty acids reduce unresolved inflammation.\n\nPolyphenols can be from berries, cacao, or other sources. High dose polyphenols allow for increased AMPK (metabolism) activity.',
    cautions: 'For educational purposes only. Not medical advice. Consult your healthcare provider.',
    display_order: 1, status: 'Published', source: 'Client package 20 Aug 2026 (Supplements)' },
  { kind: 'supplement', title: 'EPA/DHA suggested dosage', category: 'Omega 3', content_type: 'copy',
    description: 'Dosage is chosen by condition, never inferred from a tracker.',
    body: 'No chronic disease: 2.5g\nOverweight/obese, type II diabetes, CHD etc: 5g\nChronic pain: 7.5g\nNeurological disorders: 10g',
    cautions: 'For educational purposes only. Not medical advice. Consult your healthcare provider.',
    display_order: 2, status: 'Published', source: 'Client package 20 Aug 2026 (Supplements)' },
  { kind: 'supplement', title: 'Polyphenol suggested dosage', category: 'Polyphenols', content_type: 'copy',
    description: 'The same for every result.',
    body: '500mg helps reduce oxidative stress\n1000mg helps reduce inflammation\n1500mg helps reduce the rate of aging and increases mitochondrial synthesis',
    cautions: 'For educational purposes only. Not medical advice. Consult your healthcare provider.',
    display_order: 3, status: 'Published', source: 'Client package 20 Aug 2026 (Supplements)' },
  { kind: 'supplement', title: 'Individual vitamin pros and cons', category: 'Other supplements', content_type: 'article',
    description: 'Provisional educational content supplied by the Veye team — pending citation and clinical review.',
    body: 'See the approved Vitamin Overview text in the member Supplements section; it is published here as a draft until citations and clinical review are supplied.',
    cautions: 'Pending citation and clinical review. For educational purposes only. Not medical advice.',
    display_order: 4, status: 'Draft', source: 'Client package 20 Aug 2026 (Vitamin overview)' },
  { kind: 'resource', title: 'Blogs', category: 'Resources', content_type: 'link',
    description: 'Veye contributors comment on a number of factors related to wellness. Read our regularly updated articles and view the videos that interest you. Not seeing what interests you? Let us know and we will create a post with your interests in mind.',
    display_order: 1, status: 'Draft', source: 'Approved Resources card (content to be supplied)' },
  { kind: 'resource', title: 'Lifestyle', category: 'Resources', content_type: 'link',
    description: 'Explore media that focuses on daily living, personal interests, and hobbies. Veye topics include fashion, food, travel, wellness, plastic surgery, and even home decor. Want recipes, cooking tips, and tips for dining out? We have that, too.',
    display_order: 2, status: 'Draft', source: 'Approved Resources card (content to be supplied)' },
  { kind: 'resource', title: 'Articles', category: 'Resources', content_type: 'article',
    description: 'Research papers, excerpts, and articles giving you insight to the science behind the Veye program. Want academic or accessible, expert content or beginner guides, advanced research or quick reads? Veye has it all.',
    display_order: 3, status: 'Draft', source: 'Approved Resources card (content to be supplied)' },
  { kind: 'resource', title: 'Biohacks', category: 'Resources', content_type: 'article',
    description: 'Interested in making intentional changes to your exercise routine, lifestyle, or environment to optimize your physical and mental performance? Often called "do-it-yourself biology", Biohacks use science, data, and self-experimentation to take a proactive role in health and longevity. Discover Veye offerings and recommendations.',
    display_order: 4, status: 'Draft', source: 'Approved Resources card (content to be supplied)' },
];

/* ============================================================ COMPANION =====
   Sprout's settings, topic rules and member-data scopes as seeded by
   platform/api/app/companion/settings.py and policy.py. */
const COMPANION_SETTINGS = {
  enabled: true,
  name: 'Sprout',
  welcome: 'Welcome to the Veye program — I look forward to working with you. How would you like to begin? I can start with the why to — the reasons behind the program and its basics — or go straight to the how to and begin meal planning.',
  returning_welcome: "Welcome back — I'm Sprout, your Veye companion. What would you like to work on today?",
  safe_response: 'I can share what your plan already says, but anything about an amount or a medical question needs your coach to confirm.',
  fallback: 'That is outside what I can help with, but your coach can pick it up. Would you like me to pass it on?',
  escalation_response: 'Thank you for telling me. This is something a person from the Veye team should pick up with you, so I have handed this conversation to them and they will follow up.',
  quick_prompts: [
    { id: 'QP-1', label: '\u{1F37D}️ What should I eat?', prompt: 'What should I eat for lunch today?', active: true },
    { id: 'QP-2', label: "\u{1F613} I'm feeling stressed", prompt: "I'm feeling a bit stressed today.", active: true },
    { id: 'QP-3', label: '\u{1F4CA} My progress this month', prompt: 'How is my health progress this month?', active: true },
    { id: 'QP-4', label: '\u{1F34E} Suggest a snack', prompt: 'Can you suggest a low-glycemic snack?', active: true },
    { id: 'QP-5', label: "\u{1F634} I'm tired today", prompt: "I'm tired today, what should I do?", active: true },
  ],
  policy: {
    version: '1.0.0',
    topics: [
      { key: 'food', label: 'Food choices and meals', allowed: true,
        keywords: ['eat', 'meal', 'food', 'snack', 'lunch', 'dinner', 'breakfast', 'recipe', 'cook', 'protein', 'carb', 'carbohydrate', 'fat', 'hungry', 'portion', 'favorable', 'unfavorable', 'vegetable', 'fruit', 'glycemic', 'salmon', 'shopping'],
        retrieval_scopes: ['food_choices', 'help'], member_data_scopes: ['food_pattern_summary'] },
      { key: 'plan_diary', label: "The member's own plan and diary", allowed: true,
        keywords: ['diary', 'plan', 'log', 'week', 'my day', 'meal planning', 'entries', 'routine'],
        retrieval_scopes: ['help'], member_data_scopes: ['food_pattern_summary', 'mood_summary'] },
      { key: 'assessments', label: 'How Veye assessments work', allowed: true,
        keywords: ['health number', 'assessment', 'score', 'body composition', 'body fat', 'bmi', 'blood', 'marker', 'tg/hdl', 'homa', 'hba1c', 'aa/epa', 'progress', 'result', 're-take', 'retake', 'quiz', 'lower is better'],
        retrieval_scopes: ['health_number', 'assessments', 'help'],
        member_data_scopes: ['health_number_summary', 'body_composition_summary', 'blood_marker_summary'] },
      { key: 'mood', label: 'Mood and daily check-ins', allowed: true,
        keywords: ['mood', 'stress', 'stressed', 'tired', 'energy', 'sleep', 'anxious', 'feeling', 'check-in', 'calm', 'focus'],
        retrieval_scopes: ['help', 'companion'], member_data_scopes: ['mood_summary'] },
      { key: 'using_veye', label: 'Using Veye', allowed: true,
        keywords: ['veye', 'sprout', 'companion', 'dashboard', 'sign in', 'password', 'account', 'subscription', 'how do i', 'where do i', 'what can you'],
        retrieval_scopes: ['help', 'companion'], member_data_scopes: [] },
    ],
    prohibited: [
      { key: 'supplement_amounts', label: 'Supplement amounts', action: 'prohibit',
        keywords: ['how much', 'how many', 'dose', 'dosage', 'mg', 'milligram', 'grams of', 'capsule', 'iu', 'should i take', 'magnesium at night', 'take together'],
        why: 'Amounts are set by condition and confirmed by a coach.' },
      { key: 'medical', label: 'Diagnosis, symptoms and medication', action: 'escalate',
        keywords: ['diagnos', 'symptom', 'medication', 'medicine', 'prescription', 'pill', 'drug', 'chest pain', 'bleeding', 'infection', 'doctor said', 'disease', 'injection', 'metformin', 'statin', 'pregnan'],
        why: 'Always handed to a person.' },
      { key: 'wellbeing_concern', label: 'Sustained difficulty or distress', action: 'escalate',
        keywords: ["can't go on", 'cant go on', 'nothing is working', 'hopeless', 'hurt myself', 'self-harm', 'suicid', 'give up', "haven't slept properly in a week", 'not slept properly in a week'],
        why: 'Policy is to hand this to a person.' },
    ],
    member_data_scopes_enabled: ['health_number_summary', 'body_composition_summary', 'blood_marker_summary', 'mood_summary', 'food_pattern_summary'],
    escalation_categories: ['medical', 'wellbeing_concern'],
  },
  member_data_scope_options: ['health_number_summary', 'body_composition_summary', 'blood_marker_summary', 'mood_summary', 'food_pattern_summary'],
  retrieval_scope_options: {
    health_number: 'Health Number explanations', assessments: 'How Veye assessments work', help: 'Member support questions',
    food_choices: 'Food Choices guidance', companion: 'Companion guidance',
  },
};

const KNOWLEDGE_TYPES = ['VEYE educational document', 'FAQ / Help', 'Nutrition reference', 'Food Choices reference', 'Companion guidance'];

/* The approved-knowledge passages the retrieval-diagnostic search runs over —
   headings and text from the platform's synthetic knowledge documents
   (platform/api/app/seed/knowledge_content), written from published wording. */
const PASSAGES = {
  hn: [
    ['What the Health Number is', 'Your Health Number comes from the twelve questions you answer when you start with Veye: your goals, any eating plan you follow, how active you are, whether you meditate, how tired you feel, weight and abdominal weight, and three questions about sleep. It is shown on a scale of 1 to 10, where 1 is very healthy and 10 is very unhealthy. A lower Health Number is better.'],
    ['How the scale reads', 'A Health Number of 1 means good health: you are in very good health, and Veye helps you learn about optimizing your health, preventing disease and slowing the aging process.'],
    ['How the scale reads', 'A Health Number above 1 and up to 3.5 means relatively good health. Some lifestyle changes, some changes to your dietary program, or a mix of both will help you optimize your health, prevent disease and slow the aging process.'],
    ['How the scale reads', 'A Health Number above 3.5 and up to 6 means moderately good health. Incorporating better food choices and implementing some lifestyle changes will help you optimize your health, prevent disease and slow the aging process.'],
    ['Lifestyle, food or mixed', 'Veye also looks at whether the answers that raised your number were mostly about lifestyle (activity, meditation, tiredness, sleep) or mostly about food (eating plans, weight, abdominal weight).'],
    ['Re-taking the assessment', 'You can re-take the Health Number assessment whenever you like from My Progress. Every result is kept, so the history shows how your number has moved over time.'],
    ['What the Health Number is not', 'The Health Number is not a diagnosis and it does not replace advice from your doctor. Body composition and blood test markers are separate trackers in My Progress; they do not change the Health Number.'],
  ],
  help: [
    ['Where should I start?', 'For best results, after you sign in Veye suggests that you start by filling in the sections on the left in order. Create a baseline assessment by filling in a Progress Tracker of your choice, or filling in more than one.'],
    ['How do I set up my meals?', 'Then make your food choices — this will help the Veye Companion customize your meals. After you have chosen the foods you like to eat, go to Your Days and the Veye Companion will help you create meals that work around your lifestyle.'],
    ['What should I do every day?', 'Finally, fill out the food diary as often as possible. The Veye Companion will assess your choices and let you know what meals are perfect for you, and what can be improved.'],
    ["I can't sign in to my account", 'Check that you are using the email address you signed up with, and that Caps Lock is off. If you are still unable to sign in, close the tab and open Veye again before trying once more.'],
    ['My progress does not seem to be saving', 'Make sure you press Save on the screen you are filling in, and that your browser is not in private/incognito mode, which discards stored progress when the window closes.'],
    ['Why do I need to eat protein at every meal?', 'To activate glucagon and AMPK, two important components to health.'],
  ],
  companion: [
    ['What Sprout can do', 'Sprout can explain how the Veye assessments work, help you think through meals and food choices from the Veye food lists, look at how your week is going from your own diary and check-ins, and point you to the right part of your dashboard.'],
    ['What Sprout will not do', 'Sprout does not diagnose, treat or prevent any condition. Questions about symptoms, medicines, or how much of a supplement to take are always handed to a person from the Veye team.'],
    ['Your data', 'Sprout only sees short summaries of your saved Veye results, never your whole record, and it never sees your name, email address or other contact details.'],
    ['Feedback', 'Every reply has Helpful and Feedback controls. Use them: the Veye team reads the feedback and reviews conversations that were handed to a person.'],
  ],
};

/* ======================================================== HEALTH SHARING ====
   platform/api/app/health_permission/policy.py — the built-in defaults are
   ENGINEERING DRAFTS pending owner and counsel approval, and the console says so. */
const SHARING_TEMPLATE = {
  subject: 'VEYE: Review a request to share your health information',
  body: paragraphs(
    'Hi {{first_name}},',
    'The Veye team would like your permission to see the health records you keep in Veye, so they can help you with your program.',
    'Nothing is shared unless you choose to. Open the request in the Veye app to see exactly what would be shared, with whom and why, and to say yes or no. You can change your mind at any time.',
    'Questions? Write to {{support_email}}.',
  ),
};
const SHARING_TERMS = {
  summary: paragraphs('Sharing lets the Veye team open your saved results when they are helping you, and lets Veye Companion use them to answer you about your own progress. Until you share them, nobody at Veye can see them.'),
  details: paragraphs(
    'The team sees your records only inside the Veye console, only while sharing is on, and every time they open them it is recorded with who looked and when.',
    'Veye does not sell your records and does not use them for advertising.',
  ),
  purpose: 'To help you with your Veye program and to answer your questions about your own progress.',
  recipient: 'The Veye team — the people who run your Veye account',
};

/* ================================================================= SEED ===== */
function buildSeed(NOW) {
  const MIN = 6e4, HOUR = 36e5, DAY = 864e5;
  const pad = (n) => String(n).padStart(2, '0');
  /** An instant `d` days, `h` hours and `m` minutes before now. */
  const ago = (d, h = 0, m = 0) => new Date(NOW - d * DAY - h * HOUR - m * MIN).toISOString();
  /** A calendar day `d` days back, at a wall-clock time — never in the future. */
  const on = (d, hh, mm) => {
    const t = new Date(NOW - d * DAY);
    t.setHours(hh, mm, 0, 0);
    if (t.getTime() > NOW) t.setTime(NOW - 7 * MIN);
    return t.toISOString();
  };
  const dateOnly = (d) => { const t = new Date(NOW - d * DAY); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };

  /* ---- the administrators. No roles: one capability, provisioned. ---- */
  const ME = uuid('admin:cara-hogue');
  const admin = (key, first, last, email, o) => ({
    userId: uuid('admin:' + key), firstName: first, lastName: last, name: first + ' ' + last, email,
    invitation: 'accepted', invitedAt: null, invitedBy: null, acceptedAt: null, lastActiveAt: null,
    activeSessions: 0, isActive: true, deactivatedAt: null, memberId: null, photo: null, photoVersion: null, ...o,
  });
  const admins = [
    admin('cara-hogue', 'Cara', 'Hogue', 'cara.hogue@veye.example', { invitation: 'seeded', lastActiveAt: ago(0, 0, 2), activeSessions: 2 }),
    admin('priya-shah', 'Priya', 'Shah', 'priya.shah@veye.example', { invitedAt: ago(64), invitedBy: 'Cara Hogue', acceptedAt: ago(63, 20), lastActiveAt: ago(0, 3, 12), activeSessions: 1 }),
    /* One sign-in account with both kinds of access: the member's own account
       was given console access by invitation, so the ids are the account's. */
    admin('owen-wright', 'Owen', 'Wright', 'owen.wright@demo.veye.test', { userId: uuid('account:owen-wright'), invitedAt: ago(52), invitedBy: 'Cara Hogue', acceptedAt: ago(52, -2), lastActiveAt: ago(1, 4), activeSessions: 0, memberId: uuid('member:owen-wright') }),
    admin('sara-okafor', 'Sara', 'Okafor', 'sara.okafor@veye.example', { invitedAt: ago(120), invitedBy: 'Cara Hogue', acceptedAt: ago(119), lastActiveAt: ago(47, 2), isActive: false, deactivatedAt: ago(45) }),
    admin('james-lee', 'James', 'Lee', 'james.lee@veye.example', { invitation: 'expired', invitedAt: ago(5, 2), invitedBy: 'Cara Hogue' }),
    admin('jonah-reid', 'Jonah', 'Reid', 'jonah.reid@veye.example', { invitation: 'pending', invitedAt: ago(1, 6), invitedBy: 'Cara Hogue' }),
  ];

  /* Where the signed-in administrator's account is signed in right now. */
  const mySessions = [
    { id: uuid('session:me:1'), portal: 'admin', current: true, createdAt: ago(0, 1, 4), lastSeenAt: ago(0, 0, 2), remember: true },
    { id: uuid('session:me:2'), portal: 'admin', current: false, createdAt: ago(2, 5), lastSeenAt: ago(1, 22), remember: true },
  ];

  /* ---- stored results, written out as stored ---- */
  let seq = 0;
  const att = (key) => uuid('attempt:' + key + ':' + (++seq));
  const HN = (d, score, status, category) => ({ attempt_id: att('hn'), displayed_score: score, status, category, calculation_version: '1.5.0', completed_at: on(d, 14, 30) });
  const BC = (d, sex, weight, bmi, bf, reason) => {
    const fat = bf == null ? null : Math.round(weight * bf * 10 / 100) / 10;
    return { attempt_id: att('bc'), sex, bmi, body_fat_percent: bf, fat_mass_lb: fat, lean_mass_lb: fat == null ? null : Math.round((weight - fat) * 10) / 10,
      body_fat_available: bf != null, unavailable_reason: reason || null, calculation_version: '1.0.0', completed_at: on(d, 14, 30) };
  };
  /* Blood markers: the ratios, the four goal tests, and the tier the client's
     table gives — 2.5g all optimal, 3.5g every out-of-range moderate, 5g every
     out-of-range high, review for a mix. Each row was checked by hand. */
  const BM = (d, tg_hdl, homa_ir, aa_epa, hba1c, inRange, rec) => ({
    attempt_id: att('bm'), tg_hdl, homa_ir, aa_epa, markers: { hba1c },
    in_range: { tg_hdl: inRange[0], homa_ir: inRange[1], aa_epa: inRange[2], hba1c: inRange[3] },
    recommendation: rec === 'review' ? { state: 'review', epa_dha_dose: null } : { state: 'ok', epa_dha_dose: rec },
    calculation_version: '1.0.0', completed_at: on(d, 14, 30),
  });
  const HA = (d, total, status, dose) => ({ attempt_id: att('ha'), total, status, epa_dha_dose: dose, calculation_version: 'health-assessment-2026-08-25-v2', completed_at: on(d, 14, 30) });
  const SQ = (d, yes) => ({ attempt_id: att('sq'), yes_count: yes, no_count: 8 - yes, summary: `${8 - yes} No / ${yes} Yes`, calculation_version: 'simple-quiz-2026-08-20-v1', completed_at: on(d, 14, 30) });

  const MOOD_LABELS = { happy: 'Happy', excited: 'Excited', calm: 'Calm', neutral: 'Neutral', tired: 'Tired', stressed: 'Stressed', sad: 'Sad', angry: 'Angry' };
  const moods = (key, startDaysAgo, pattern, notes = {}) => pattern.map((mood, i) => ({
    id: uuid('mood:' + key + ':' + i), entry_date: dateOnly(startDaysAgo + i), mood, mood_label: MOOD_LABELS[mood], note: notes[i] || '',
    created_at: on(startDaysAgo + i, 20, 15), updated_at: on(startDaysAgo + i, 20, 15),
  }));
  const meal = (key, d, time, description, feelings = [], notes = '') => ({
    id: uuid('meal:' + key + ':' + d + ':' + time), entry_date: dateOnly(d), meal_time: time, description, feelings, notes,
    created_at: on(d, +time.slice(0, 2), +time.slice(3)), updated_at: on(d, +time.slice(0, 2), +time.slice(3)),
  });
  const session = (flow, status, node, startedDaysAgo, updatedDaysAgo, completed) => ({
    flow_key: flow, flow_title: flow === 'first_time_user' ? 'First-Time User' : 'Progress Tracker Guide', flow_version: 1,
    status, current_node: node, started_at: on(startedDaysAgo, 19, 40), updated_at: on(updatedDaysAgo, 19, 52),
    completed_at: completed ? on(updatedDaysAgo, 19, 52) : null,
  });

  /* ---- sharing: what the member decided, and the email that asked ---- */
  const sent = (email, d, h = 0) => ({ status: 'sent', attempts: 1, last_error: null, sent_at: ago(d, h), next_attempt_at: null, to_email: email });
  const share = {
    granted: (email, askedDays) => ({ state: 'granted', requested_at: ago(askedDays), requested_by_name: 'Cara Hogue', decided_at: ago(askedDays - 1, 3), revoked_at: null,
      policy_version: 'health-sharing-terms-v1', source: 'member_app', delivery: sent(email, askedDays) }),
    none: () => ({ state: 'not_requested', requested_at: null, requested_by_name: '', decided_at: null, revoked_at: null, policy_version: '', delivery: null }),
  };

  const member = (key, first, last, o) => {
    const email = o.email || `${first.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}.${last.toLowerCase()}@demo.veye.test`;
    return {
      id: uuid('member:' + key), accountId: uuid('account:' + key), firstName: first, lastName: last, name: first + ' ' + last,
      initials: (first[0] + last[0]).toUpperCase(), email, pendingEmail: null,
      emailVerified: true, isActive: true, deactivatedAt: null, isSynthetic: true, adminAccess: false,
      joinedAt: ago(o.joined, 2 + (first.length % 5), (last.length * 7) % 60), lastActiveAt: o.lastActive === null ? null : ago(...(o.lastActive || [1])),
      onboarding: 'Complete', phone: null, postalCode: null, photo: null, photoVersion: null,
      activeSessions: 0, lastSessionAt: null,
      sharing: share.none(),
      records: { health_number: [], body_composition: [], blood_markers: [], health_assessment: [], simple_quiz: [] },
      mood: [], diary: [], guided: [],
      ...o, email,
    };
  };

  const members = [
    member('cara-morgan', 'Cara', 'Morgan', {
      joined: 212, lastActive: [0, 1, 12], phone: '+1 555 0142', postalCode: '97205', activeSessions: 1, lastSessionAt: ago(0, 1, 12),
      sharing: share.granted('cara.morgan@demo.veye.test', 61),
      records: {
        health_number: [HN(33, 3.5, 'Relatively Good Health', 'food'), HN(121, 4, 'Moderately Good Health', 'mixed')],
        body_composition: [BC(40, 'Woman', 148, 24.6, 29)],
        blood_markers: [BM(36, 1.58, 1.05, 2.25, 5, [false, false, true, true], '3.5g'), BM(118, 3.33, 2.04, 4, 5.5, [false, false, false, false], 'review')],
        health_assessment: [HA(35, 16, 'Low Inflammation', '2.5g')],
        simple_quiz: [SQ(12, 2), SQ(74, 4)],
      },
      mood: moods('cara-morgan', 1, ['calm', 'happy', 'neutral', 'tired', 'calm', 'happy', 'stressed', 'calm', 'excited', 'calm', 'neutral', 'happy', 'tired', 'calm', 'happy', 'calm', 'neutral', 'calm'],
        { 0: 'Walked to the farmers market', 3: 'Short night — up early with the dog', 6: 'Deadline week' }),
      diary: [
        meal('cara-morgan', 1, '07:40', 'Greek yoghurt with walnuts and blueberries', ['Hungry'], ''),
        meal('cara-morgan', 1, '12:30', 'Grilled chicken salad with avocado', ['Rushed'], 'At my desk'),
        meal('cara-morgan', 1, '19:10', 'Baked salmon, broccoli and quinoa', ['Relaxed'], ''),
        meal('cara-morgan', 2, '08:05', 'Two eggs and spinach', ['Not hungry', 'Tired'], ''),
        meal('cara-morgan', 2, '13:00', 'Lentil soup and a side salad', ['Hungry'], ''),
        meal('cara-morgan', 2, '19:30', 'Turkey chilli with black beans', ['Relaxed'], 'Batch-cooked for the week'),
        meal('cara-morgan', 4, '07:55', 'Overnight oats with almond butter', ['Hungry'], ''),
        meal('cara-morgan', 4, '12:45', 'Tuna and white bean salad', ['Energized'], ''),
        meal('cara-morgan', 4, '18:50', 'Chicken thigh, sweet potato and green beans', ['Hungry', 'Tired'], ''),
      ],
      guided: [session('first_time_user', 'completed', 'complete', 58, 57, true), session('progress_tracker_guide', 'in_progress', 'pt_blood', 13, 12)],
    }),
    member('lena-ortiz', 'Lena', 'Ortiz', {
      joined: 186, lastActive: [0, 4, 5], phone: '+1 555 0188', postalCode: '78704', pendingEmail: 'lena.ortiz.home@demo.veye.test',
      sharing: share.granted('lena.ortiz@demo.veye.test', 44),
      records: {
        health_number: [HN(16, 2.5, 'Relatively Good Health', 'lifestyle'), HN(92, 3, 'Relatively Good Health', 'lifestyle')],
        health_assessment: [HA(18, 14, 'Low Inflammation', '2.5g')],
        simple_quiz: [SQ(17, 1)],
        body_composition: [], blood_markers: [],
      },
      mood: moods('lena-ortiz', 0, ['happy', 'calm', 'calm', 'excited', 'neutral', 'calm', 'happy', 'tired', 'calm', 'happy'], { 0: 'Yoga before work' }),
      diary: [
        meal('lena-ortiz', 0, '07:15', 'Smoked salmon on rye with cucumber', ['Hungry'], ''),
        meal('lena-ortiz', 1, '12:20', 'Quinoa bowl with chickpeas and feta', ['Energized'], ''),
        meal('lena-ortiz', 1, '19:00', 'Prawn stir-fry with bok choy', ['Relaxed'], ''),
        meal('lena-ortiz', 3, '08:10', 'Cottage cheese with peaches', ['Hungry'], ''),
      ],
      guided: [session('first_time_user', 'completed', 'complete', 40, 40, true)],
    }),
    member('robert-williams', 'Robert', 'Williams', {
      joined: 361, lastActive: [0, 19, 40], phone: '+1 555 0165', postalCode: '60614', activeSessions: 1, lastSessionAt: ago(0, 19, 40),
      sharing: share.granted('robert.williams@demo.veye.test', 70),
      records: {
        health_number: [HN(9, 7.5, 'Insulin Resistance Risk', 'mixed'), HN(68, 8, 'Insulin Resistance Risk', 'mixed'), HN(150, 7, 'Insulin Resistance Risk', 'food')],
        blood_markers: [BM(11, 3.6, 3.4, 7.2, 8.4, [false, false, false, false], '5g'), BM(95, 0.92, 1.4, 3.4, 5.6, [true, false, false, false], '3.5g')],
        body_composition: [BC(66, 'Man', 205, 29.4, 24)],
        health_assessment: [], simple_quiz: [],
      },
      mood: moods('robert-williams', 2, ['tired', 'stressed', 'neutral', 'tired', 'sad', 'neutral']),
      guided: [session('progress_tracker_guide', 'paused', 'pt_body', 21, 20)],
    }),
    member('aisha-bello', 'Aisha', 'Bello', {
      joined: 136, lastActive: [0, 2, 30], phone: '+1 555 0221', postalCode: '33130',
      sharing: share.granted('aisha.bello@demo.veye.test', 50),
      records: {
        health_number: [HN(8, 1, 'Good Health', 'food'), HN(71, 1.5, 'Relatively Good Health', 'food')],
        body_composition: [BC(10, 'Woman', 141, 23.5, 27), BC(73, 'Woman', 146, 24.3, 28)],
        blood_markers: [BM(14, 0.85, 0.9, 2.4, 5, [true, true, true, true], '2.5g')],
        health_assessment: [HA(9, 11, 'Very Low Inflammation', '2.5g')],
        simple_quiz: [SQ(9, 0)],
      },
      mood: moods('aisha-bello', 0, ['happy', 'happy', 'calm', 'excited', 'calm', 'happy', 'calm', 'neutral', 'happy', 'happy', 'calm', 'excited', 'calm', 'happy', 'calm', 'happy', 'neutral', 'calm', 'happy', 'calm', 'happy'],
        { 2: 'Long run, felt great' }),
      diary: [
        meal('aisha-bello', 0, '07:30', 'Spinach omelette with feta', ['Hungry'], ''),
        meal('aisha-bello', 0, '12:40', 'Chicken and avocado lettuce wraps', ['Energized'], ''),
        meal('aisha-bello', 1, '19:20', 'Cod, asparagus and new potatoes', ['Relaxed'], ''),
        meal('aisha-bello', 2, '07:45', 'Berries, Greek yoghurt and almonds', ['Hungry'], ''),
        meal('aisha-bello', 2, '13:10', 'Turkey and hummus wholegrain wrap', ['Hungry'], ''),
        meal('aisha-bello', 3, '18:55', 'Beef and broccoli stir-fry', ['Relaxed'], 'Cooked with my sister'),
      ],
      guided: [session('first_time_user', 'completed', 'complete', 49, 48, true)],
    }),
    member('daniel-kim', 'Daniel', 'Kim', {
      joined: 137, lastActive: [1, 2, 15], phone: '+1 555 0199', postalCode: '02116',
      sharing: { state: 'requested', requested_at: ago(1, 3), requested_by_name: 'Cara Hogue', decided_at: null, revoked_at: null, policy_version: '',
        delivery: sent('daniel.kim@demo.veye.test', 1, 3) },
      records: {
        health_number: [HN(8, 5, 'Moderately Good Health', 'food')],
        blood_markers: [BM(15, 1.58, 1.05, 2.25, 5, [false, false, true, true], '3.5g')],
        body_composition: [], health_assessment: [], simple_quiz: [],
      },
      mood: moods('daniel-kim', 1, ['neutral', 'calm', 'tired']),
      guided: [session('first_time_user', 'in_progress', 'b4', 6, 6)],
    }),
    member('sophie-patel', 'Sophie', 'Patel', {
      joined: 207, lastActive: [2, 5], phone: '+1 555 0177', postalCode: '98103',
      sharing: { state: 'requested', requested_at: ago(2, 1), requested_by_name: 'Cara Hogue', decided_at: null, revoked_at: null, policy_version: '',
        delivery: { status: 'retry', attempts: 2, last_error: '421 4.7.0 Temporary system problem. Try again later.', sent_at: null, next_attempt_at: ago(0, -1), to_email: 'sophie.patel@demo.veye.test' } },
      records: { health_number: [HN(27, 4.5, 'Moderately Good Health', 'lifestyle')], simple_quiz: [SQ(26, 3)], body_composition: [], blood_markers: [], health_assessment: [] },
      mood: moods('sophie-patel', 2, ['stressed', 'tired', 'neutral', 'calm']),
    }),
    member('tomas-rivera', 'Tomás', 'Rivera', {
      joined: 313, lastActive: [5, 7], phone: '+1 555 0233', postalCode: '85004',
      sharing: { state: 'declined', requested_at: ago(21), requested_by_name: 'Priya Shah', decided_at: ago(19, 4), revoked_at: null, policy_version: 'health-sharing-terms-v1',
        delivery: sent('tomas.rivera@demo.veye.test', 21) },
      records: { health_number: [HN(36, 4, 'Moderately Good Health', 'mixed'), HN(126, 4.5, 'Moderately Good Health', 'mixed')], body_composition: [], blood_markers: [], health_assessment: [], simple_quiz: [] },
    }),
    member('peter-novak', 'Peter', 'Novak', {
      joined: 427, lastActive: [3, 1], phone: '+1 555 0250', postalCode: '10023',
      sharing: { state: 'revoked', requested_at: ago(88), requested_by_name: 'Cara Hogue', decided_at: ago(87), revoked_at: ago(9, 2), policy_version: 'health-sharing-terms-v1',
        delivery: sent('peter.novak@demo.veye.test', 88) },
      records: {
        health_number: [HN(40, 3, 'Relatively Good Health', 'lifestyle'), HN(140, 3.5, 'Relatively Good Health', 'lifestyle')],
        body_composition: [BC(42, 'Man', 172, 24.7, 13)], health_assessment: [HA(41, 19, 'Moderate Inflammation', '5g')],
        blood_markers: [], simple_quiz: [],
      },
      mood: moods('peter-novak', 10, ['calm', 'neutral', 'happy']),
    }),
    member('maya-chen', 'Maya', 'Chen', {
      joined: 3, lastActive: [2, 22], emailVerified: false, onboarding: 'Not started', phone: '+1 555 0210', postalCode: '80202',
    }),
    member('grace-lin', 'Grace', 'Lin', {
      joined: 13, lastActive: [0, 6, 40], postalCode: '92101',
      records: { health_number: [HN(13, 6, 'Moderately Good Health', 'food')], body_composition: [], blood_markers: [], health_assessment: [], simple_quiz: [] },
      guided: [session('progress_tracker_guide', 'skipped', 'pt_intro', 12, 12)],
    }),
    member('hannah-weiss', 'Hannah', 'Weiss', {
      joined: 260, lastActive: [31], isActive: false, deactivatedAt: ago(26, 4),
      records: { health_number: [HN(80, 2, 'Relatively Good Health', 'lifestyle')], body_composition: [], blood_markers: [], health_assessment: [], simple_quiz: [] },
    }),
    member('sam-okonkwo', 'Sam', 'Okonkwo', {
      joined: 49, lastActive: [0, 9, 10], phone: '+1 555 0266', postalCode: '30309',
      sharing: share.granted('sam.okonkwo@demo.veye.test', 30),
      records: {
        health_number: [HN(48, 5.5, 'Moderately Good Health', 'mixed')],
        health_assessment: [HA(20, 22, 'Moderate Inflammation', '7.5g')],
        simple_quiz: [SQ(6, 3), SQ(45, 5)], body_composition: [BC(44, 'Man', 196, 27.9, null, 'Measurements outside the supplied table')], blood_markers: [],
      },
      mood: moods('sam-okonkwo', 0, ['neutral', 'tired', 'calm', 'happy', 'neutral', 'stressed', 'calm']),
      diary: [meal('sam-okonkwo', 0, '08:30', 'Scrambled eggs with smoked salmon', ['Hungry'], ''), meal('sam-okonkwo', 1, '13:15', 'Chicken caesar salad, no croutons', ['Rushed'], '')],
      guided: [session('first_time_user', 'in_progress', 'a2', 3, 2)],
    }),
    member('owen-wright', 'Owen', 'Wright', {
      joined: 52, lastActive: [1, 4], adminAccess: true,
      sharing: share.granted('owen.wright@demo.veye.test', 20),
      records: { health_number: [HN(19, 2.5, 'Relatively Good Health', 'food')], body_composition: [], blood_markers: [], health_assessment: [], simple_quiz: [] },
    }),
  ];
  const byKey = (key) => members.find((m) => m.id === uuid('member:' + key));
  const mid = (key) => uuid('member:' + key);

  /* ---- Sprout: conversations, as the console's transcript view shows them ---- */
  const SRC = { hn: { title: 'Health Number guide', source_version: 1 }, help: { title: 'Help and FAQs', source_version: 1 }, comp: { title: 'How Sprout helps', source_version: 1 } };
  let msgSeq = 0;
  const say = (d, h, m, content, o = {}) => ({ id: uuid('msg:' + (++msgSeq)), role: 'member', content, created_at: ago(d, h, m), outcome: null,
    policy_decision: o.policy ? { outcome: o.policy[0], category: o.policy[1] || null } : null, sources: [], provider: null, model: null,
    latency_ms: null, safety_result: null, feedback: null });
  const sprout = (d, h, m, content, o = {}) => ({ id: uuid('msg:' + (++msgSeq)), role: 'sprout', content, created_at: ago(d, h, m),
    outcome: o.outcome || 'answered', policy_decision: null, sources: o.sources || [],
    provider: o.model === false ? null : 'mock', model: o.model === false ? null : 'veye-mock-1',
    latency_ms: o.model === false ? null : (o.latency || 6), safety_result: o.model === false ? 'not_generated' : 'pass', feedback: o.feedback || null });
  const conversation = (key, memberKey, o) => {
    const messages = o.messages;
    return { id: uuid('conversation:' + key), member_id: mid(memberKey), started_at: messages[0].created_at,
      last_message_at: messages[messages.length - 1].created_at, message_count: messages.length,
      flagged: !!o.flag, flag_reason: o.flag || null, reviewed_at: o.reviewedAt || null, reviewed_by: o.reviewedBy || null, messages };
  };
  const conversations = [
    conversation('cara-1', 'cara-morgan', {
      flag: "Handed to a person: Policy is to hand this to a person. (rule 'nothing is working').",
      messages: [
        say(0, 5, 22, 'Explain what my Health Number means in plain language', { policy: ['allow', 'assessments'] }),
        sprout(0, 5, 21, 'Your Health Number runs from 1 to 10, and a lower number is better. Yours sits in the relatively good range: some lifestyle or food changes would help you optimise your health. It is not a diagnosis, and body composition and blood markers do not change it.',
          { sources: [SRC.hn], feedback: { rating: 'helpful', reason: null } }),
        say(0, 5, 19, 'How much EPA should I take each day?', { policy: ['prohibit', 'supplement_amounts'] }),
        sprout(0, 5, 19, COMPANION_SETTINGS.safe_response, { outcome: 'prohibited', model: false }),
        say(0, 5, 16, "I haven't slept properly in a week and I feel like nothing is working.", { policy: ['escalate', 'wellbeing_concern'] }),
        sprout(0, 5, 16, COMPANION_SETTINGS.escalation_response, { outcome: 'escalated', model: false }),
      ],
    }),
    conversation('robert-1', 'robert-williams', {
      flag: "Handed to a person: Always handed to a person. (rule 'metformin').",
      messages: [
        say(1, 2, 40, 'My number went up again. Can I stop my metformin if I follow the plan properly?', { policy: ['escalate', 'medical'] }),
        sprout(1, 2, 40, COMPANION_SETTINGS.escalation_response, { outcome: 'escalated', model: false }),
      ],
    }),
    conversation('lena-1', 'lena-ortiz', {
      messages: [
        say(3, 6, 2, 'What should I eat for lunch today?', { policy: ['allow', 'food'] }),
        sprout(3, 6, 2, 'Build lunch around a palm-sized protein, then add favorable carbohydrates such as leafy greens and a little healthy fat like olive oil or avocado. Your Food Choices list has the ones you picked.',
          { sources: [SRC.help], latency: 7, feedback: { rating: 'helpful', reason: null } }),
        say(3, 6, 0, 'Thanks — and a snack for later?', { policy: ['allow', 'food'] }),
        sprout(3, 5, 59, 'A handful of almonds with an apple, or cottage cheese with berries, keeps the protein in.', { sources: [SRC.help], latency: 5 }),
      ],
    }),
    conversation('aisha-1', 'aisha-bello', {
      flag: "Handed to a person: Always handed to a person. (rule 'symptom').", reviewedAt: ago(14, 2), reviewedBy: 'Priya Shah',
      messages: [
        say(15, 4, 10, 'I get a headache every afternoon — is that a symptom of something?', { policy: ['escalate', 'medical'] }),
        sprout(15, 4, 10, COMPANION_SETTINGS.escalation_response, { outcome: 'escalated', model: false }),
        say(15, 4, 4, 'Ok, thanks.', { policy: ['off_topic'] }),
        sprout(15, 4, 4, COMPANION_SETTINGS.fallback, { outcome: 'off_topic', model: false, feedback: { rating: 'helpful', reason: null } }),
      ],
    }),
    conversation('sam-1', 'sam-okonkwo', {
      messages: [
        say(2, 9, 30, 'Can you recommend a good film for tonight?', { policy: ['off_topic'] }),
        sprout(2, 9, 30, COMPANION_SETTINGS.fallback, { outcome: 'off_topic', model: false, feedback: { rating: 'not_helpful', reason: 'Did not answer my question', comment: 'Fair enough, just curious.' } }),
        say(2, 9, 27, 'How do I retake the Health Number?', { policy: ['allow', 'assessments'] }),
        sprout(2, 9, 27, 'You can re-take the Health Number assessment whenever you like from My Progress. Every result is kept, so your history shows how the number has moved.', { sources: [SRC.hn], latency: 6 }),
      ],
    }),
    conversation('owen-1', 'owen-wright', {
      messages: [
        say(6, 3, 12, 'What can you help me with?', { policy: ['allow', 'using_veye'] }),
        sprout(6, 3, 12, 'I can explain how the Veye assessments work, help you think through meals from the Veye food lists, look at how your week is going from your own diary and check-ins, and point you to the right part of your dashboard.',
          { sources: [SRC.comp], latency: 8, feedback: { rating: 'helpful', reason: null } }),
      ],
    }),
  ];

  /* Member feedback on Sprout replies, with the review state the console keeps. */
  const feedback = [];
  conversations.forEach((c) => c.messages.forEach((msg) => {
    if (!msg.feedback) return;
    const reviewed = c.id === uuid('conversation:aisha-1');
    feedback.push({ id: uuid('feedback:' + msg.id), conversation_id: c.id, message_id: msg.id, member_id: c.member_id,
      rating: msg.feedback.rating, reason: msg.feedback.reason || null, comment: msg.feedback.comment || null,
      submitted_at: new Date(Date.parse(msg.created_at) + 90 * 1000).toISOString(),
      reviewed_at: reviewed ? ago(13, 22) : null, reviewed_by: reviewed ? 'Priya Shah' : null, reply_excerpt: msg.content.slice(0, 140) });
  }));

  /* ---- Requests & Inbox ---- */
  const reply = (key, d, h, body, to, by, failed) => ({ id: uuid('reply:' + key), body, to_email: to, sent_by_name: by,
    delivery_status: failed ? 'failed' : 'sent', delivery_detail: failed ? '550 5.1.1 Mailbox unavailable' : null, created_at: ago(d, h) });
  const request = (key, o) => ({ id: uuid('request:' + key), kind: 'contact_us', status: 'new', source: 'public', member_id: null, name: '', email: '',
    subject: '', message: '', page: null, created_at: ago(o.d, o.h || 0), updated_at: ago(o.d, o.h || 0), handled_by: null, handled_at: null,
    resolution_note: '', replies: [], ...o });
  const requests = [
    request('cara-history', { d: 0, h: 2, kind: 'contact_us', source: 'member', member_id: mid('cara-morgan'), name: 'Cara Morgan', email: 'cara.morgan@demo.veye.test',
      subject: 'Question about my assessment history', page: '/app/contact',
      message: 'Hi — my Health Number from the summer is not showing in My Progress any more. Did it get deleted when I retook it?',
      replies: [reply('cara-history-1', 0, 1, 'Hi Cara,\n\nNothing was deleted — every result is kept. My Progress shows the latest one first; open History under the Health Number card to see the earlier result.\n\nBest,\nCara (Veye team)', 'cara.morgan@demo.veye.test', 'Cara Hogue', false)] }),
    request('visitor-marker', { d: 0, h: 7, kind: 'help_question', status: 'in_progress', name: '', email: 'visitor.r@demo.veye.test', subject: '',
      message: 'Where can I update a blood marker?', page: '/help', handled_by: 'Cara Hogue', handled_at: ago(0, 6, 40),
      resolution_note: 'Checking whether they already have an account under another address.' }),
    request('grace-beta', { d: 1, h: 4, kind: 'join_beta', source: 'member', member_id: mid('grace-lin'), name: 'Grace Lin', email: 'grace.lin@demo.veye.test',
      subject: 'Beta application', message: '', page: '/app' }),
    request('robert-quiz', { d: 6, h: 2, kind: 'help_question', status: 'resolved', source: 'member', member_id: mid('robert-williams'), name: 'Robert Williams',
      email: 'robert.williams@demo.veye.test', subject: 'How do I retake the Simple Quiz?', message: 'How do I retake the Simple Quiz? I can only see my old answers.', page: '/app/help',
      handled_by: 'Priya Shah', handled_at: ago(5, 20), resolution_note: 'Pointed to My Progress → Simple Quiz → Take it again.',
      replies: [reply('robert-quiz-1', 5, 21, 'Hi Robert,\n\nOpen My Progress, choose Simple Quiz and press "Take it again" under your last result. Your earlier answers stay in the history.\n\nPriya', 'robert.williams@demo.veye.test', 'Priya Shah', false)] }),
    request('marsh-contact', { d: 2, h: 3, kind: 'contact_us', status: 'in_progress', name: 'Jordan Marsh', email: 'jordan.marsh@bounces.demo.veye.test',
      subject: 'Pricing for a family of four', message: 'Do you offer a family plan? There are four of us and two would like the coaching.', page: '/contact',
      handled_by: 'Cara Hogue', handled_at: ago(1, 23), resolution_note: 'Reply bounced. Try the phone number on the form next.',
      replies: [reply('marsh-1', 1, 23, 'Hi Jordan,\n\nThank you for asking. A family plan is not offered in the Beta yet; I have added your interest to the list and will write as soon as it is.\n\nCara', 'jordan.marsh@bounces.demo.veye.test', 'Cara Hogue', true)] }),
    request('anon-help', { d: 3, h: 1, kind: 'help_question', name: '', email: '', subject: '',
      message: 'Is the Simple Quiz the same as the Health Number? The help page does not say.', page: '/help' }),
    request('sam-beta', { d: 9, h: 5, kind: 'join_beta', status: 'resolved', source: 'member', member_id: mid('sam-okonkwo'), name: 'Sam Okonkwo', email: 'sam.okonkwo@demo.veye.test',
      subject: 'Beta application', message: '', page: '/app', handled_by: 'Cara Hogue', handled_at: ago(8, 20), resolution_note: 'Added to the Beta cohort.',
      replies: [reply('sam-beta-1', 8, 21, 'Hi Sam,\n\nYou are in — welcome to the Veye Beta. Your dashboard already has everything switched on.\n\nCara', 'sam.okonkwo@demo.veye.test', 'Cara Hogue', false)] }),
    request('daniel-email', { d: 0, h: 9, kind: 'contact_us', source: 'member', member_id: mid('daniel-kim'), name: 'Daniel Kim', email: 'daniel.kim@demo.veye.test',
      subject: 'Please correct the email on my account', message: 'I signed up with my work address by mistake. Can it be changed to my personal one?', page: '/app/contact' }),
  ];
  requests.forEach((r) => { if (r.replies.length) r.updated_at = r.replies[r.replies.length - 1].created_at; });

  /* ---- Prospects: visitors' saved results — metadata only ---- */
  const EV = (type, actor, d, h = 0, policyVersion = null) => ({ event_type: type, actor_type: actor, at: ago(d, h), policy_version: policyVersion });
  const prospect = (key, o) => {
    const captured = o.captured;
    const days = o.days || 30;
    return {
      id: uuid('prospect:' + key), email: o.email || null, status: o.status, captured_at: ago(captured[0], captured[1] || 0),
      expires_at: o.expires !== undefined ? o.expires : new Date(Date.parse(ago(captured[0], captured[1] || 0)) + days * DAY).toISOString(),
      retention_mode: 'days', retention_days: days, source: 'public_assessment', email_verified: !!o.verified,
      registered_member_id: o.member || null, claimed_at: o.claimedAt || null, erased_at: o.erasedAt || null,
      consent_version: 'prospect-capture-2026-11-14-draft-v1', retention_policy_version: o.policy || 2, calculation_version: '1.5.0',
      events: o.events,
    };
  };
  const prospects = [
    prospect('p01', { email: 'adele.fox@demo.veye.test', status: 'unverified', captured: [0, 3], events: [EV('captured', 'visitor', 0, 3, 2)] }),
    prospect('p02', { email: 'ben.ortega@demo.veye.test', status: 'unverified', captured: [2, 1], events: [EV('captured', 'visitor', 2, 1, 2)] }),
    prospect('p03', { email: 'chloe.marr@demo.veye.test', status: 'verified', verified: true, captured: [4, 6], events: [EV('captured', 'visitor', 4, 6, 2), EV('email_verified', 'visitor', 4, 5)] }),
    prospect('p04', { email: 'dev.raman@demo.veye.test', status: 'verified', verified: true, captured: [9, 2], events: [EV('captured', 'visitor', 9, 2, 2), EV('email_verified', 'visitor', 9, 1), EV('link_resent', 'visitor', 3, 4)] }),
    prospect('p05', { email: 'elle.brandt@demo.veye.test', status: 'unverified', captured: [24, 2], events: [EV('captured', 'visitor', 24, 2, 2)] }),
    prospect('p06', { email: 'finn.osei@demo.veye.test', status: 'verified', verified: true, captured: [27, 5], events: [EV('captured', 'visitor', 27, 5, 2), EV('email_verified', 'visitor', 27, 4)] }),
    prospect('p07', { email: 'gita.mehra@demo.veye.test', status: 'pending_claim', verified: false, captured: [6, 4], events: [EV('captured', 'visitor', 6, 4, 2), EV('linked_at_signup', 'member', 5, 23)] }),
    prospect('p08', { email: 'grace.lin@demo.veye.test', status: 'claimed', verified: true, captured: [14, 2], member: mid('grace-lin'), claimedAt: ago(13),
      events: [EV('captured', 'visitor', 14, 2, 2), EV('email_verified', 'visitor', 14, 1), EV('linked_at_signup', 'member', 13, 1), EV('claimed', 'member', 13)] }),
    prospect('p09', { email: 'sam.okonkwo@demo.veye.test', status: 'claimed', verified: true, captured: [50, 3], member: mid('sam-okonkwo'), claimedAt: ago(49),
      events: [EV('captured', 'visitor', 50, 3, 1), EV('email_verified', 'visitor', 50, 2), EV('linked_at_signup', 'member', 49, 2), EV('claimed', 'member', 49)], days: 45, policy: 1 }),
    prospect('p10', { status: 'expired', captured: [72, 1], days: 45, policy: 1, expires: ago(40),
      events: [EV('captured', 'visitor', 72, 1, 1), EV('retention_shortened', 'administrator', 40, 0, 2), EV('purged', 'system', 40)] }),
    prospect('p11', { status: 'expired', captured: [48, 2], days: 45, policy: 1, expires: ago(18, 2),
      events: [EV('captured', 'visitor', 48, 2, 1), EV('retention_shortened', 'administrator', 40, 0, 2), EV('purged', 'system', 18)] }),
    prospect('p12', { status: 'erased', captured: [20, 7], erasedAt: ago(18, 3), expires: ago(-10, 7),
      events: [EV('captured', 'visitor', 20, 7, 2), EV('erased', 'visitor', 18, 3)] }),
    prospect('p13', { status: 'erased', verified: true, captured: [11, 6], erasedAt: ago(10, 2), expires: ago(-19, 6),
      events: [EV('captured', 'visitor', 11, 6, 2), EV('email_verified', 'visitor', 11, 5), EV('erased', 'administrator', 10, 2)] }),
    prospect('p14', { email: 'hugo.lind@demo.veye.test', status: 'unverified', captured: [31, 4], events: [EV('captured', 'visitor', 31, 4, 2)] }),
  ];

  /* Retention: how long an unsigned-up visitor's saved result is kept. */
  const retention = {
    mode: 'days', days: 30, version: 2, published_at: ago(40), published_by: 'Cara Hogue',
    history: [
      { version: 2, mode: 'days', days: 30, published_at: ago(40), published_by: 'Cara Hogue', note: 'Approved by Cara — 30 days is enough to come back and sign up' },
      { version: 1, mode: 'days', days: 45, published_at: ago(75), published_by: 'Cara Hogue', note: 'Beta launch' },
    ],
    last_cleanup: { job: 'purge-prospects', status: 'ok', dry_run: false, started_at: ago(0, 6, 1), finished_at: ago(0, 6), counts: { due: 0, purged: 0 }, error: null, triggered_by: 'nightly schedule' },
    encryption_ready: true, encryption_is_development_key: true,
  };

  /* ---- Deletions (erasure requests): ids, states and dates only ---- */
  const erasures = [
    { request_id: uuid('erasure:1'), subject_user_id: uuid('erasure-user:1'), subject_member_id: uuid('erasure-member:1'), scope: 'entire_identity', state: 'purge_blocked',
      requested_at: ago(1, 5), completed_at: null, attempts: 2, failure_category: 'object_storage', stage: 'access_closed' },
    { request_id: uuid('erasure:2'), subject_user_id: uuid('erasure-user:2'), subject_member_id: uuid('erasure-member:2'), scope: 'entire_identity', state: 'access_closed',
      requested_at: ago(0, 0, 4), completed_at: null, attempts: 0, failure_category: null, stage: 'access_closed' },
    { request_id: uuid('erasure:3'), subject_user_id: uuid('erasure-user:3'), subject_member_id: uuid('erasure-member:3'), scope: 'member_data', state: 'erased',
      requested_at: ago(12, 3), completed_at: ago(12, 3), attempts: 1, failure_category: null, stage: 'receipt_queued' },
    { request_id: uuid('erasure:4'), subject_user_id: uuid('erasure-user:4'), subject_member_id: uuid('erasure-member:4'), scope: 'entire_identity', state: 'erased',
      requested_at: ago(33, 6), completed_at: ago(33, 6), attempts: 1, failure_category: null, stage: 'receipt_queued' },
  ];

  /* ---- Care Studio and Content ---- */
  const careItems = CARE_ITEMS.map((c, i) => ({
    id: uuid('care:' + i), kind: c.kind, title: c.title, description: c.description || '', category: c.category || null, content_type: c.content_type,
    youtube_url: c.youtube_url || null, external_url: c.external_url || null, video_object_key: null, body: c.body || '', cautions: c.cautions || null,
    references: c.references || null, display_order: c.display_order, status: c.status, source: c.source,
    created_at: ago(56, 4), updated_at: ago(56, 4), updated_by: CARE_SEED_BY,
    published_at: c.status === 'Published' ? ago(56, 4) : null, published_by: c.status === 'Published' ? CARE_SEED_BY : null,
  }));
  const contentEntries = HELP_FAQ.map(([key, category, title, body], i) => ({
    id: uuid('content:help:' + key), group: 'help_faq', key, category, title, body, display_order: i + 1, status: 'Published',
    source: 'build/help.html (client-approved FAQ)', updated_at: ago(56, 4), updated_by: CARE_SEED_BY, published_at: ago(56, 4), published_by: CARE_SEED_BY,
  })).concat(MEMBER_COPY.map((c) => ({
    id: uuid('content:copy:' + c.key), group: 'member_copy', key: c.key, category: null, title: c.title, body: c.body, display_order: c.order, status: c.status,
    source: c.source || 'Approved member screens (build/dashboard.html)', updated_at: ago(56, 4), updated_by: CARE_SEED_BY,
    published_at: c.status === 'Published' ? ago(56, 4) : null, published_by: c.status === 'Published' ? CARE_SEED_BY : null,
  })));

  /* ---- Knowledge sources Sprout may draw on ---- */
  const approver = 'Cara Hogue';
  const source = (key, title, type, scope, description, filename, chunks, status, passagesKey) => {
    const id = uuid('knowledge:' + key);
    const doc = { id: uuid('document:' + key), source_version: 1, filename, content_type: 'text/markdown', byte_size: 900 + chunks * 410,
      sha256: hex('sha:' + key, 64), is_current: true, ingestion_status: 'ingested', ingestion_error: null, extraction_note: null,
      chunk_count: chunks, ingested_at: ago(60, 2), created_at: ago(60, 2) };
    return { id, title, type, scope_key: scope, description, reference_label: filename, status, version: 1, approved_by: approver,
      approved_at: ago(60, 1), effective_date: null, is_synthetic: true, created_at: ago(60, 3), updated_at: ago(60, 1),
      archived_at: status === 'Archived' ? ago(58) : null, current_document: doc, documents: [doc], storage: 'local-file',
      passages: (PASSAGES[passagesKey] || []).map(([heading, text], i) => ({ chunk_id: uuid('chunk:' + key + ':' + i), document_id: doc.id, heading, text })) };
  };
  const knowledgeSources = [
    source('hn', 'Health Number guide', 'VEYE educational document', 'health_number', 'Plain-language explanation of the Health Number and what a lower result means.', 'health-number-guide.md', 7, 'Active', 'hn'),
    source('help', 'Help and FAQs', 'FAQ / Help', 'help', 'Approved answers to common member questions about using VEYE.', 'help-and-faqs.md', 23, 'Active', 'help'),
    source('comp', 'How Sprout helps', 'Companion guidance', 'companion', 'What the Companion can and cannot do, and how member data is handled.', 'companion-guidance.md', 5, 'Active', 'companion'),
    source('food', 'Food Choices reference', 'Food Choices reference', 'food_choices', 'Approved food-category wording used when members ask about their selections.', 'food-choices-reference.md', 6, 'Inactive', null),
    source('old', 'Superseded welcome note', 'Companion guidance', 'companion', 'An earlier welcome wording retained as an archived record.', 'superseded-welcome-note.md', 2, 'Archived', null),
  ];

  /* ---- Guided experiences: Cara's decision trees, published as versions ---- */
  const flows = window.VeyeGuidedFlowData || {};
  const guidedFlows = ['first_time_user', 'progress_tracker_guide'].map((key) => {
    const def = flows[key] || { title: key, nodes: {}, content_meta: {} };
    return { id: uuid('flow:' + key + ':1'), key, title: def.title, version: 1, status: 'Active', source: 'Cara Decision Tree',
      content_meta: def.content_meta || {}, node_count: Object.keys(def.nodes || {}).length, created_at: ago(57, 5), updated_at: ago(57, 5),
      published_at: ago(57, 5), published_by: 'seed' };
  });

  /* ---- telemetry: one masked record per Sprout turn ---- */
  const telemetry = [];
  conversations.forEach((c) => {
    const ref = hex('member-ref:' + c.member_id, 16);
    const session = hex('session-ref:' + c.id, 16);
    let lastPolicy = null;
    c.messages.forEach((msg) => {
      if (msg.role === 'member') { lastPolicy = msg.policy_decision; return; }
      const answered = !!msg.provider;
      telemetry.push({ trace_id: uuid('trace:' + msg.id), created_at: msg.created_at, member_ref: ref, session_ref: session, conversation_id: c.id,
        provider: msg.provider, model: msg.model, latency_ms: answered ? msg.latency_ms : 0, input_tokens: null, output_tokens: null,
        policy_outcome: lastPolicy ? lastPolicy.outcome : 'off_topic', policy_category: lastPolicy ? lastPolicy.category : null,
        safety_result: msg.safety_result || 'not_generated', retrieval_count: msg.sources.length,
        top_retrieval_score: msg.sources.length ? 0.58 + (fnv(msg.id) % 30) / 100 : null,
        feedback: msg.feedback ? msg.feedback.rating : null, error_category: null, exporters: 'database' });
    });
  });
  telemetry.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  /* ---- the admin audit log: who changed what, newest first ---- */
  let auditSeq = 0;
  const A = (d, h, actor, action, entityType, entityId, details = {}) => ({ id: uuid('audit:' + (++auditSeq)), created_at: ago(d, h), actor_name: actor,
    action, entity_type: entityType, entity_id: entityId, details });
  const adminId = (key) => uuid('admin:' + key);
  const audit = [
    A(0, 1, 'Cara Hogue', 'requests.replied', 'member_request', uuid('request:cara-history'), { kind: 'contact_us', delivery: 'sent' }),
    A(0, 6, 'Cara Hogue', 'requests.in_progress', 'member_request', uuid('request:visitor-marker'), { kind: 'help_question', status: 'in_progress' }),
    A(1, 2, 'Cara Hogue', 'member_account.verification_resent', 'user_account', uuid('account:maya-chen'), { email: 'maya.chen@demo.veye.test' }),
    A(1, 3, 'Cara Hogue', 'health_permission.requested', 'member', mid('daniel-kim'), { state: 'requested', policy_version: 'health-sharing-terms-v1', with_reason: false }),
    A(1, 6, 'Cara Hogue', 'administrator.invited', 'user_account', adminId('jonah-reid'), { email: 'jonah.reid@veye.example', new_account: true, delivery: 'sent' }),
    A(1, 23, 'Cara Hogue', 'requests.replied', 'member_request', uuid('request:marsh-contact'), { kind: 'contact_us', delivery: 'failed' }),
    A(2, 1, 'Cara Hogue', 'health_permission.requested', 'member', mid('sophie-patel'), { state: 'requested', policy_version: 'health-sharing-terms-v1', with_reason: false }),
    A(3, 2, 'Priya Shah', 'member_account.password_reset_sent', 'user_account', uuid('account:robert-williams'), { email: 'robert.williams@demo.veye.test' }),
    A(5, 2, 'Cara Hogue', 'administrator.invited', 'user_account', adminId('james-lee'), { email: 'james.lee@veye.example', new_account: true, delivery: 'sent' }),
    A(5, 20, 'Priya Shah', 'requests.resolved', 'member_request', uuid('request:robert-quiz'), { kind: 'help_question', status: 'resolved' }),
    A(10, 2, 'Cara Hogue', 'prospect.erased', 'prospect', uuid('prospect:p13'), { reason: 'Asked by phone to delete it' }),
    A(12, 4, 'Cara Hogue', 'settings.health_sharing.notification_published', 'policy', 'health_sharing_notification', { version: 2, mode: 'manual', resend_interval_hours: 72 }),
    A(13, 22, 'Priya Shah', 'feedback.reviewed', 'companion_feedback', (feedback.find((f) => f.reviewed_at) || {}).id || null, {}),
    A(14, 2, 'Priya Shah', 'conversation.reviewed', 'companion_conversation', uuid('conversation:aisha-1'), { note: null }),
    A(21, 0, 'Priya Shah', 'health_permission.requested', 'member', mid('tomas-rivera'), { state: 'requested', policy_version: 'health-sharing-terms-v1', with_reason: false }),
    A(26, 4, 'Cara Hogue', 'member_account.deactivated', 'user_account', uuid('account:hannah-weiss'), { email: 'hannah.weiss@demo.veye.test' }),
    A(30, 3, 'Cara Hogue', 'settings.health_sharing.template_published', 'policy', 'health_sharing_email', { version: 1, hash: hex('tpl:1', 64) }),
    A(30, 3, 'Cara Hogue', 'settings.health_sharing.terms_published', 'policy', 'health_sharing_terms', { version: 1, hash: hex('terms:1', 64), material_change: false }),
    A(30, 4, 'Cara Hogue', 'settings.health_sharing.notification_published', 'policy', 'health_sharing_notification', { version: 1, mode: 'manual', resend_interval_hours: 168 }),
    A(33, 2, 'Cara Hogue', 'settings.updated', 'companion_settings', '1', { enabled: true, policy_version: '1.0.0' }),
    A(40, 0, 'Cara Hogue', 'settings.prospect_retention.applied_to_existing', 'policy', 'prospect_retention', { version: 2, shortened: 2, purged_now: 1 }),
    A(40, 0, 'Cara Hogue', 'settings.prospect_retention.published', 'policy', 'prospect_retention', { version: 2, mode: 'days', days: 30, previous_version: 1, acknowledged_forever: false }),
    A(45, 0, 'Cara Hogue', 'administrator.deactivated', 'user_account', adminId('sara-okafor'), { email: 'sara.okafor@veye.example' }),
    A(52, 0, 'Cara Hogue', 'administrator.invited', 'user_account', uuid('account:owen-wright'), { email: 'owen.wright@demo.veye.test', new_account: false, delivery: 'sent' }),
    A(57, 5, 'Cara Hogue', 'guided_flow.activated', 'guided_flow', uuid('flow:first_time_user:1'), { key: 'first_time_user', version: 1 }),
    A(57, 5, 'Cara Hogue', 'guided_flow.activated', 'guided_flow', uuid('flow:progress_tracker_guide:1'), { key: 'progress_tracker_guide', version: 1 }),
    A(60, 1, 'Cara Hogue', 'knowledge_source.activated', 'knowledge_source', uuid('knowledge:hn'), { title: 'Health Number guide' }),
    A(60, 1, 'Cara Hogue', 'knowledge_source.activated', 'knowledge_source', uuid('knowledge:help'), { title: 'Help and FAQs' }),
    A(60, 1, 'Cara Hogue', 'knowledge_source.activated', 'knowledge_source', uuid('knowledge:comp'), { title: 'How Sprout helps' }),
    A(64, 0, 'Cara Hogue', 'administrator.invited', 'user_account', adminId('priya-shah'), { email: 'priya.shah@veye.example', new_account: true, delivery: 'sent' }),
    A(75, 0, 'Cara Hogue', 'settings.prospect_retention.published', 'policy', 'prospect_retention', { version: 1, mode: 'days', days: 45, previous_version: 0, acknowledged_forever: false }),
  ];

  /* ---- Settings → Product settings → Health sharing: three versioned policies ---- */
  const sharingSettings = {
    notification: { mode: 'manual', resend_interval_hours: 72, sender_name: 'VEYE Team', version: 2, published_at: ago(12, 4), published_by: 'Cara Hogue',
      history: [
        { version: 2, published_at: ago(12, 4), published_by: 'Cara Hogue', note: null, hash: hex('notification:2', 64) },
        { version: 1, published_at: ago(30, 4), published_by: 'Cara Hogue', note: null, hash: hex('notification:1', 64) },
      ] },
    template: { value: JSON.parse(JSON.stringify(SHARING_TEMPLATE)), version: 1, draft: null,
      history: [{ version: 1, published_at: ago(30, 3), published_by: 'Cara Hogue', note: null, hash: hex('tpl:1', 64) }] },
    terms: { value: JSON.parse(JSON.stringify(SHARING_TERMS)), version: 1, draft: null,
      history: [{ version: 1, published_at: ago(30, 3), published_by: 'Cara Hogue', note: null, hash: hex('terms:1', 64) }] },
  };

  return {
    schema: 3,
    generatedAt: new Date(NOW).toISOString(),
    org: { name: 'Veye', supportEmail: 'contact@veye.co', supportPhone: '', supportUpdatedAt: ago(9, 3), supportUpdatedBy: 'Cara Hogue' },
    meId: ME,
    admins, mySessions, members, conversations, feedback, requests, prospects, retention, erasures,
    careItems, contentEntries, knowledgeSources, guidedFlows, telemetry, audit, sharingSettings,
    companion: JSON.parse(JSON.stringify(COMPANION_SETTINGS)),
    companionUpdatedAt: ago(33, 2), companionUpdatedBy: 'Cara Hogue',
    invitations: {},
  };
}

window.Veye = window.Veye || { screens: {} };
window.Veye.buildSeed = buildSeed;
window.Veye.SEED_CONTENT = { KNOWLEDGE_TYPES, SHARING_TEMPLATE, SHARING_TERMS, COMPANION_SETTINGS, txt, paragraphs, uuid, hex };

})();
