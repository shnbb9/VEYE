"""First-Time User — GuidedFlow definition v1.

GENERATED from the client document dump (260627  Intro Decision Tree.docx); quoted copy is verbatim
client text (copy_origin "client"), "client_paraphrase" marks a question Cara
wrote inside a sentence, and "derived" marks the connective runtime lines that
are not her words. Do not hand-edit the quoted text: regenerate from the
document if Cara revises it, and publish it as a new version."""

DEFINITION = {'key': 'first_time_user',
 'title': 'First-Time User',
 'version': 1,
 'start': 'intro',
 'description': 'Cara’s Intro Decision Tree: WHY TO Basics, WHY TO Advanced science and Tips as deterministic guided education; HOW TO meal planning '
                'is the AI boundary.',
 'content_meta': {'source': 'Cara Decision Tree',
                  'client_supplied': True,
                  'clinical_review_status': 'pending',
                  'source_version': '260627',
                  'source_date': '2026-06-27',
                  'source_file': 'FEEDBACK3/260627  Intro Decision Tree.docx',
                  'note': 'Health/science education copy is client-supplied and reproduced verbatim; it has not been independently clinically '
                          'validated.',
                  'explore_message': 'Great, if you want my assistance start a conversation with me in the Veye Bot. A good place to start are the '
                                     'Progress Trackers'},
 'sections': [{'key': 'intro', 'title': 'Welcome', 'start': 'intro', 'kind': 'deterministic'},
              {'key': 'basics', 'title': 'WHY TO — Basics of the Veye program', 'start': 'b1', 'kind': 'deterministic'},
              {'key': 'advanced', 'title': 'WHY TO — Advanced science', 'start': 'a1', 'kind': 'deterministic'},
              {'key': 'tips', 'title': 'Tips', 'start': 't1', 'kind': 'deterministic'},
              {'key': 'how_to', 'title': 'HOW TO — Meal planning (AI, not yet specified)', 'start': 'how_to', 'kind': 'ai'}],
 'nodes': {'intro': {'type': 'CHOICE',
                     'section': 'intro',
                     'text': 'Welcome to the Veye program. I look forward to working with you. How would you like to begin? Would like to know the '
                             '"WHY TO" follow the program and some of the basics of the Veye program, or would you like to go straight to the "HOW '
                             'TO" section and start meal planning?',
                     'source_ref': '260627  Intro Decision Tree.docx ¶009–010',
                     'copy_origin': 'client',
                     'choices': [{'key': 'why_to', 'label': 'The “why to” — the reasons and the basics', 'next': 'b1'},
                                 {'key': 'how_to', 'label': 'The “how to” — start meal planning', 'next': 'how_to'}]},
           'b1': {'type': 'CHOICE',
                  'section': 'basics',
                  'text': 'First we will cover the”why to,” then we will go over “how to” To start, you can largely control your health by the foods '
                          'you eat. All disease starts with excess inflammation in the body. Veye will help you create an anti-inflammatory diet '
                          'that fits in your lifestyle by simply combining the foods you eat in the best way for your health. Are you ready to hear '
                          'about the effects of carbohydrates, protein and fat on your underlying health?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶015–016',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'b2'}, {'key': 'no', 'label': 'No', 'next': 'b_to_how_to'}]},
           'b2': {'type': 'CHOICE',
                  'section': 'basics',
                  'text': 'Foods are either carbohydrates, proteins or fats. There are a few foods, like milk, yogurt and soft tofu, that contain '
                          'all three. The types of carbohydrates you eat affect your health. All carbohydrates turn into blood sugar, whether they '
                          'are grains, fruits or vegetables. Carbohydrates are important because the brain can only use blood sugar for energy. '
                          'Although the muscles can use blood sugar, they can also use body fat as energy. So some controlled blood sugar is '
                          'important to feed the brain. With me so far?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶019',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'b3'}, {'key': 'no', 'label': 'No', 'next': 'b_ready_foods'}]},
           'b3': {'type': 'CHOICE',
                  'section': 'basics',
                  'text': 'What makes a carbohydrate favorable or unfavorable is the glycemic index, or how quickly the sugar enters the blood '
                          'stream as glucose. Unfavorable carbohydrates enter the blood stream quickly, cause a quick rise in blood sugar which '
                          'makes the brain happy, but then a quick rise in insulin in response to the blood sugar. This is the start of insulin '
                          'resistance, carbohydrate addiction, and chronic disease. Still with me? I would like to go over a few more points about '
                          'carbohydrates.',
                  'source_ref': '260627  Intro Decision Tree.docx ¶025–026',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'b4'}, {'key': 'no', 'label': 'No', 'next': 'b_ready_foods'}]},
           'b4': {'type': 'CHOICE',
                  'section': 'basics',
                  'text': 'It is important to control insulin because excess insulin causes excess inflammation, and excess inflammation is the '
                          'underlying cause of all chronic disease. You can largely control insulin by controlling your glycemic index. Would you '
                          'like to learn how you can control your glycemic index?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶032',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'b5'}, {'key': 'no', 'label': 'No', 'next': 'b_ready_foods'}]},
           'b5': {'type': 'CHOICE',
                  'section': 'basics',
                  'text': 'Let’s consider three carbohydrates- a whole grain bagel, two apples, and 16 cups of broccoli. All of these have the same '
                          "amount of sugar, yet they all have a different effect on blood sugar and the insulin response. Let's say you eat the "
                          'bagel. The whole grain bagel is a complex carbohydrate, and therefore unfavorable despite being “whole grain.” All '
                          'complex carbohydrates enter the bloodstream quickly as glucose. This fast raise in blood sugar causes a fast rise in '
                          'insulin. Can I explain the problem with excess insulin?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶038',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'b6'}, {'key': 'no', 'label': 'No', 'next': 'b_ready_foods'}]},
           'b6': {'type': 'CHOICE',
                  'section': 'basics',
                  'text': 'First, insulin is a storage hormone, and only some calories can be stored in the muscles for muscle energy, the excess '
                          'calories not used are stored as fat. Again, excess carbs, especially complex carbs, are stored as fat. In addition, the '
                          'quick rise in blood sugar can start insulin resistance as the muscles cannot take in more sugar. Further, since insulin '
                          'removes the sugar from the blood stream quickly the brain has no blood sugar for energy, and within an hour or so signals '
                          'hunger. This is the start of carbohydrate addiction. And to make it worse, insulin triggers hormones that increase '
                          'inflammation- the start of the chronic disease process. Lastly, insulin impedes AMPK, an enzyme responsible for '
                          'metabolism and energy burning. Can you see how important it is to control insulin, and would you like to hear about '
                          'favorable carbohydrates?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶044',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'b7'}, {'key': 'no', 'label': 'No', 'next': 'b_ready_foods'}]},
           'b7': {'type': 'CHOICE',
                  'section': 'basics',
                  'text': 'Conversely, the sugar in two apples enter the blood stream more slowly, insulin rises slowly, the brain has a steady '
                          'supply of blood sugar, and hunger can be controlled for up to 5 hours. Apples have fructose based sugars which are '
                          'converted in the liver to glucose, and apples have fiber which also slows digestion and blood sugar release, so insulin '
                          'is controlled. And as you can imagine no one is likely to eat 16 cups of broccoli, so you can eat unlimited amounts of '
                          'these super favorable carbs, and they are also great for gut health. That is the beginning of the carbohydrate and '
                          'insulin story. Would you like to hear about the importance of proteins in controlling chronic disease and overall health?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶051',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'b8'}, {'key': 'no', 'label': 'No', 'next': 'b_ready_foods'}]},
           'b8': {'type': 'CHOICE',
                  'section': 'basics',
                  'text': 'You may know that proteins are made of amino acids, which are the building blocks for your muscles. Proteins are also '
                          'important in satiety- or appetite suppression. Sufficient amounts of protein help signal the brain you have eaten. Would '
                          'you like to hear about the hormonal effects of eating protein?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶057',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'b9'}, {'key': 'no', 'label': 'No', 'next': 'b_ready_foods'}]},
           'b9': {'type': 'CHOICE',
                  'section': 'basics',
                  'text': 'A less known fact is that sufficient protein also signals the release of glucagon. Glucagon does the opposite of insulin. '
                          'Glucagon activates enzymes that release stored body fat to feed the muscles, saving the blood sugar for the brain. So the '
                          'right amount of protein helps burn fat. Glucagon also plays a role in activating anti-inflammatory hormones and enzymes, '
                          'helping to decrease inflammation and prevent or reduce chronic disease. It is important to remember that too much protein '
                          'can have a negative effect, so avoid high protein diets. The balance of carbohydrates and proteins is key to good health. '
                          'The final piece is the types of fat in your diet. Do you have the stamina to hear about the different types of fats and '
                          'their role in your health?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶063',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'b10'}, {'key': 'no', 'label': 'No', 'next': 'b_ready_foods'}]},
           'b10': {'type': 'CHOICE',
                   'section': 'basics',
                   'text': 'Fats are more than just calories. Fats signal the brain that you have eaten so you do not overeat, fats are part of the '
                           'cell walls, good fats are beneficial to cell and vascular health, and some fats are hormonal modifiers. Shall I go on?',
                   'source_ref': '260627  Intro Decision Tree.docx ¶069',
                   'copy_origin': 'client',
                   'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'b11'}, {'key': 'no', 'label': 'No', 'next': 'b_ready_foods'}]},
           'b11': {'type': 'CHOICE',
                   'section': 'basics',
                   'text': 'The benefits of Omega 3 fatty acids DHA and EPA, or fish oils, are well documented. Omega 3 fatty acids help decrease '
                           'inflammation and therefore chronic disease. These fats are supplements. Would you like to understand the different types '
                           'of food fats?',
                   'source_ref': '260627  Intro Decision Tree.docx ¶075',
                   'copy_origin': 'client',
                   'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'b12'}, {'key': 'no', 'label': 'No', 'next': 'b_ready_foods'}]},
           'b12': {'type': 'CHOICE',
                   'section': 'basics',
                   'text': 'Fats known as Omega 9 have a neutral effect on inflammation, and are the fats Veye recommends when adding calories. '
                           'Monounsaturated Omega 9 are the best source, and are the most beneficial to cells and vascular health. There are fats '
                           'known as Omega 6, found in vegetable oils and certain nuts. These are pro-inflammatory and should be used in moderation. '
                           'Trans fat or partially hydrogenated oils have been linked to chronic disease and cancer, and the Veye program advises '
                           'you to remove them from your diet. Ready for some key points?',
                   'source_ref': '260627  Intro Decision Tree.docx ¶081',
                   'copy_origin': 'client',
                   'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'b13'}, {'key': 'no', 'label': 'No', 'next': 'b_ready_foods'}]},
           'b_to_how_to': {'type': 'MESSAGE',
                           'section': 'basics',
                           'text': 'let’s go to the HOW TO section and start your meal plan.',
                           'source_ref': '260627  Intro Decision Tree.docx ¶018',
                           'copy_origin': 'client',
                           'next': 'how_to'},
           'b_ready_foods': {'type': 'CHOICE',
                             'section': 'basics',
                             'text': 'Are you ready to start choosing foods?',
                             'source_ref': '260627  Intro Decision Tree.docx ¶022',
                             'copy_origin': 'client',
                             'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'how_to'}, {'key': 'no', 'label': 'No', 'next': 'b_start_over'}]},
           'b_start_over': {'type': 'MESSAGE',
                            'section': 'basics',
                            'text': 'Let’s start over',
                            'source_ref': '260627  Intro Decision Tree.docx ¶024',
                            'copy_origin': 'client',
                            'next': 'b1'},
           'b13': {'type': 'CHOICE',
                   'section': 'basics',
                   'text': 'The Veye program helps combine the right carbs, proteins and fats in the right combination to maximize your health and '
                           'combat chronic disease. Understanding carbs, proteins and fats is the first step. There is another part of the science '
                           'that looks deeper into the biology of anti-aging and chronic disease management. Would you like to explore these '
                           'concepts, or save them for later and get to the "how to" part and build a meal plan?',
                   'source_ref': '260627  Intro Decision Tree.docx ¶087',
                   'copy_origin': 'client',
                   'choices': [{'key': 'explore_concepts', 'label': 'Explore these concepts (Advanced)', 'next': 'a1'},
                               {'key': 'how_to', 'label': 'Save them for later — get to the “how to”', 'next': 'b_tips_offer'}]},
           'b_tips_offer': {'type': 'CHOICE',
                            'section': 'basics',
                            'text': 'Would you like some general tips before we start the “how to?”',
                            'source_ref': '260627  Intro Decision Tree.docx ¶089',
                            'copy_origin': 'client',
                            'choices': [{'key': 'yes', 'label': 'Yes', 'next': 't1'}, {'key': 'no', 'label': 'No', 'next': 'b_ready_meals'}]},
           'b_ready_meals': {'type': 'CHOICE',
                             'section': 'basics',
                             'text': 'Are you ready to start choosing foods and creating meals?',
                             'source_ref': '260627  Intro Decision Tree.docx ¶091',
                             'copy_origin': 'client',
                             'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'how_to'}, {'key': 'no', 'label': 'No', 'next': 'b_start_over'}]},
           'a1': {'type': 'CHOICE',
                  'section': 'advanced',
                  'text': 'The goal is to extend health span by optimizing the body’s internal healing response and activating AMPK. Beyond the 20th '
                          'Century thinking of vitamins and supplements, in the 21st century the Veye program is based on new findings in systems '
                          'biology. The Veye program focuses on the foods you eat and how they are combined. You cannot use micronutrients '
                          '(supplements) to fix a macronutrient (food choice) issue. Shall I continue with the science of inflammation?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶095',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'a2'}, {'key': 'no', 'label': 'No', 'next': 'a_tips_offer'}]},
           'a2': {'type': 'CHOICE',
                  'section': 'advanced',
                  'text': 'All chronic diseases are low levels of unresolved inflammation, inflammation below the pain threshold. The Veye program '
                          'is anti-inflammatory and will help you control your health, control or reduce chronic diseases you may have, and slow the '
                          'aging process through the foods you eat. Shall I continue with more information on aging and chronic disease, or go to '
                          'the food choice section?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶104',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'a3'}, {'key': 'no', 'label': 'No', 'next': 'a_tips_offer'}]},
           'a3': {'type': 'CHOICE',
                  'section': 'advanced',
                  'text': 'Aging and disease are also known as immunosenescence, or preventing the normal removal of senescent (old/aging) cells. '
                          'Senescent cells are formed by a blocked resolution response caused by elevated glucose levels which in turn is caused by '
                          'insulin resistance and excess inflammation. Once a cell becomes senescent, it begins secreting large quantities of '
                          'inflammatory mediators that disrupt the local microenvironment of the tissue and induce the development of senescence in '
                          'neighboring cells. If not removed, senescent cells infect surrounding cells. Shall I go on?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶112',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'a4'}, {'key': 'no', 'label': 'No', 'next': 'a_tips_offer'}]},
           'a4': {'type': 'CHOICE',
                  'section': 'advanced',
                  'text': 'The Veye program can reduce, resolve, and repair the damage caused by the initial inflammation. Your health is dependent '
                          'on resolving unnecessary inflammation that can lead to chronic disease and speeds the aging process. Ready to hear about '
                          'the major players in disease management?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶120',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'a5'}, {'key': 'no', 'label': 'No', 'next': 'a_tips_offer'}]},
           'a5': {'type': 'CHOICE',
                  'section': 'advanced',
                  'text': 'A major factor in disease and aging is Nuclear Factor Kappa B. NF-kB controls cytokines- it turns on inflammation and '
                          'increases the COX-2 enzyme which produces many pro-inflammatory eicosanoids. NF-kB , and therefore inflammation, '
                          'Increases with increased insulin. The Veye program minimized the damaging effects of NF-kB. Shall I continue with the '
                          'factors that promote health and metabolism?”',
                  'source_ref': '260627  Intro Decision Tree.docx ¶128',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'a6'}, {'key': 'no', 'label': 'No', 'next': 'a_tips_offer'}]},
           'a6': {'type': 'CHOICE',
                  'section': 'advanced',
                  'text': 'On the other hand, the enzyme adenosine 5’ monophosphate-activated protein kinase or AMPK promotes the repair of the '
                          'damage caused by the initial inflammation, and also inhibits NF-kB and oxidation when cellular energy is low. AMPK is '
                          'important in metabolism and is affected by the foods you eat. The Veye program helps promote AMPK production. Can I '
                          'provide just a few important aspects of AMPK?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶136',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'a7'}, {'key': 'no', 'label': 'No', 'next': 'a_tips_offer'}]},
           'a7': {'type': 'CHOICE',
                  'section': 'advanced',
                  'text': 'AMPK is involved in cellular energy homeostasis, largely to activate glucose and fatty acid use. That is, one aspect is '
                          'AMPK helps the body use energy and burn fat. AMPK also promotes the repair of damage done by NF-kB. Elevated glucose from '
                          'too many carbs or complex carbs, inhibits AMPK. Would you like to continue with how the Veye program can help you manage '
                          'chronic disease and slow aging?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶144',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'a8'}, {'key': 'no', 'label': 'No', 'next': 'a_tips_offer'}]},
           'a8': {'type': 'CHOICE',
                  'section': 'advanced',
                  'text': 'The Veye program creates a therapeutic zone of inflammation The Veye program can help you reduce Inflammation by '
                          'inhibiting NF-κB and decreasing pro-inflammatory signaling molecules through diet. The Veye program will Improve your '
                          'health by the resolution of inflammation, and repair cell damage by increasing resolvins and activation of AMPK. Shall I '
                          'give some supplement tips before we get to the food choice section?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶152',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'a9'}, {'key': 'no', 'label': 'No', 'next': 'a_tips_offer'}]},
           'a9': {'type': 'CHOICE',
                  'section': 'advanced',
                  'text': 'In addition to paying attention to the foods you eat, you can use omega-3 fatty acids and polyphenols to activate AMPK, '
                          'inhibit NF-kB, and generate adequate levels of resolvins and AMPK to resolve inflammation. The result is slowing, '
                          'halting, or even reversing particular chronic diseases associated with aging. This non-pharmaceutical approach requires a '
                          'consistent and comprehensive nutritional intervention program that is personalized to you. We have covered the basic '
                          'science. Would you like some general tips before creating their individualized program?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶160',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 't1'}, {'key': 'no', 'label': 'No', 'next': 'a_ready_meals'}]},
           'a_tips_offer': {'type': 'CHOICE',
                            'section': 'advanced',
                            'text': 'Would you like some general tips before we start the “how to?”',
                            'source_ref': '260627  Intro Decision Tree.docx ¶098',
                            'copy_origin': 'client',
                            'choices': [{'key': 'yes', 'label': 'Yes', 'next': 't1'}, {'key': 'no', 'label': 'No', 'next': 'a_ready_meals'}]},
           'a_ready_meals': {'type': 'CHOICE',
                             'section': 'advanced',
                             'text': 'Are you ready to start choosing foods and creating meals?',
                             'source_ref': '260627  Intro Decision Tree.docx ¶100',
                             'copy_origin': 'client',
                             'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'how_to'}, {'key': 'no', 'label': 'No', 'next': 'a_start_over'}]},
           'a_start_over': {'type': 'MESSAGE',
                            'section': 'advanced',
                            'text': 'Let’s start over',
                            'source_ref': '260627  Intro Decision Tree.docx ¶102',
                            'copy_origin': 'client',
                            'next': 'a1'},
           't1': {'type': 'QUESTION',
                  'section': 'tips',
                  'text': 'To begin, carbohydrate addiction is real, and like any addiction changes can be “cold turkey” or in steps. Mindfulness is '
                          'the first step, simply being aware of what you are eating and why. Can you start by being aware of what you eat, and why '
                          'at the time? Sometimes eating is emotional.',
                  'source_ref': '260627  Intro Decision Tree.docx ¶166',
                  'copy_origin': 'client',
                  'next': 't2',
                  'answer_label': 'Continue'},
           't2': {'type': 'QUESTION',
                  'section': 'tips',
                  'text': 'Another tip is to stop drinking liquid calories - give up or decrease juice, soda, and diet soda. Try decaf tea or decaf '
                          'coffee, flavored seltzers, water, or other beverages without sweeteners or sugar. If you drink calories, even diet '
                          'drinks, do you think you can begin to cut down? It is ok to start slowly cutting out a little at a time.',
                  'source_ref': '260627  Intro Decision Tree.docx ¶168',
                  'copy_origin': 'client',
                  'next': 't3',
                  'answer_label': 'Continue'},
           't3': {'type': 'QUESTION',
                  'section': 'tips',
                  'text': 'If you are not ready for big changes, make gradual changes in your favorable and unfavorable carbohydrate ratio. I will '
                          'help you do this. Can you start to add some super favorable carbohydrates when you are eating unfavorable carbohydrates?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶170',
                  'copy_origin': 'client',
                  'next': 't4',
                  'answer_label': 'Continue'},
           't4': {'type': 'QUESTION',
                  'section': 'tips',
                  'text': 'Food is not “good” or “bad” there are healthier choices. The level of “healthy” is up to you. can you start to let go of '
                          '“good or bad” and think of “healthy and unhealthy?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶172',
                  'copy_origin': 'client',
                  'next': 't5',
                  'answer_label': 'Continue'},
           't5': {'type': 'QUESTION',
                  'section': 'tips',
                  'text': 'Calorie restriction is the only way where there is evidence to increase longevity. Fasting and intermittent fasting are '
                          'popular, and work to a degree. However, you will achieve better results through calorie restriction and regulated eating '
                          'Do you think you can eat consistently throughout the day?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶174',
                  'copy_origin': 'client',
                  'next': 't6',
                  'answer_label': 'Continue'},
           't6': {'type': 'QUESTION',
                  'section': 'tips',
                  'text': 'First make changes to your diet that are healthier, then change to a healthier diet I will help you make changes that you '
                          'can live with. Are you prepared to try this?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶176',
                  'copy_origin': 'client',
                  'next': 't7',
                  'answer_label': 'Continue'},
           't7': {'type': 'QUESTION',
                  'section': 'tips',
                  'text': 'Build on success rather than focusing on failure, every meal is a new opportunity to get on track. Can you try and look '
                          'forward to creating the next meal rather than worrying if a meal already eaten was not ideal?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶178',
                  'copy_origin': 'client',
                  'next': 't8',
                  'answer_label': 'Continue'},
           't8': {'type': 'CHOICE',
                  'section': 'tips',
                  'text': 'Exercise is important for many reasons including weight management, though exercise is not effective for significant '
                          'weight loss. You cannot exercise away an unhealthy diet. And finally, whether you think you can or whether you think you '
                          'can’t, you’re right! Those are some tips to get you started. Are you ready to learn "how to" implement the program and '
                          'make a food plan?',
                  'source_ref': '260627  Intro Decision Tree.docx ¶180',
                  'copy_origin': 'client',
                  'choices': [{'key': 'yes', 'label': 'Yes', 'next': 'how_to'}, {'key': 'no', 'label': 'No', 'next': 't_review'}]},
           't_review': {'type': 'CHOICE',
                        'section': 'tips',
                        'text': 'Would you like to review the Basics, Advanced Science, or TIPS?',
                        'source_ref': '260627  Intro Decision Tree.docx ¶182',
                        'copy_origin': 'client',
                        'choices': [{'key': 'basics', 'label': 'Review the Basics', 'next': 'b1'},
                                    {'key': 'advanced', 'label': 'Review the Advanced science', 'next': 'a1'},
                                    {'key': 'tips', 'label': 'Review the Tips', 'next': 't1'},
                                    {'key': 'no', 'label': 'No — not right now', 'next': 't_break'}]},
           't_break': {'type': 'MESSAGE',
                       'section': 'tips',
                       'text': 'Let’s take a break until you are ready to resume.',
                       'source_ref': '260627  Intro Decision Tree.docx ¶184',
                       'copy_origin': 'client',
                       'next': 't8',
                       'pause': True},
           'how_to': {'type': 'AI_TASK',
                      'section': 'how_to',
                      'text': 'The “how to” — building your meal plan with me — is the AI part of the program, and it is not connected in the Veye '
                              'application yet. Cara’s training material for it is still to come. For now, Food Choices is where your meal planning '
                              'begins.',
                      'source_ref': '260627  Intro Decision Tree.docx ¶005, 013',
                      'copy_origin': 'derived',
                      'task': 'how_to_meal_planning',
                      'choices': [{'key': 'open_food_choices', 'label': 'Open Food Choices', 'next': 'how_to_nav'},
                                  {'key': 'finish', 'label': 'Finish for now', 'next': 'done'}]},
           'how_to_nav': {'type': 'NAVIGATION',
                          'section': 'how_to',
                          'text': 'Opening Food Choices for you.',
                          'source_ref': '260627  Intro Decision Tree.docx ¶005',
                          'copy_origin': 'derived',
                          'action': {'type': 'OPEN_FOOD_CHOICES'},
                          'next': 'done'},
           'done': {'type': 'COMPLETE',
                    'section': 'how_to',
                    'text': 'That completes the introduction. You can review the Basics, the Advanced science or the Tips with me whenever you like.',
                    'source_ref': '260627  Intro Decision Tree.docx ¶—',
                    'copy_origin': 'derived'}}}
