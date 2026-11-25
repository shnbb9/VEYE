/* What the prototype's Sprout says when somebody may not be all right.

   The application reads every message with far more care than this
   (platform/api/app/companion/distress.py) and tells a person. The prototype
   has nobody to tell and says so: it only makes sure that a plain sentence is
   never answered with a snack. Same words as the application
   (companion/safety_copy.py), fixed, no AI, nothing stored, nothing sent. */
(function () {
  'use strict';
  const PROGRAM = "I'm a program, not a clinician or a crisis service.";
  const NOBODY = 'This is a prototype: nobody reads what is typed here.';
  const NOT_SO = /\b(?:i'?m|i am|i was|i feel) (?:definitely |really )?(?:not|never) suicidal\b|\b(?:don'?t|do not|never|wouldn'?t|not going to) (?:want to |ever |plan to )*(?:kill|hurt|harm) myself\b|\bto die for\b|\bdying (?:to|for)\b|\bdie of (?:laughter|laughing|embarrassment)\b/g;
  const SAID = [
    [/\b(?:(?:going|about|ready) to|i'?ll) (?:kill|hang|shoot) myself\b|\bend(?:ing)? (?:my life|it all) (?:tonight|now|today)\b|\bkill myself (?:tonight|now|today)\b/,
      "I'm really glad you told me. Your safety comes first. Please contact your local emergency services now, or go to the nearest emergency department. If you can, tell someone near you and stay with them, and move away from anything you could use to hurt yourself."],
    [/\btook? (?:too many|too much|all (?:of )?my)\b[^.?!]{0,20}\b(?:pills?|tablets?|meds?|medication|insulin)\b|\boverdos(?:ed|ing)\b(?! on (?:cake|chocolate|coffee|sugar|pizza))|\bcan'?t breathe\b|\bchest pains?\b|\bhaving a (?:heart attack|stroke|seizure)\b/,
      "That could be a medical emergency. Please contact your local emergency services now, or ask someone near you to do it. If too much of a medicine, a supplement or anything harmful was taken, a poison information service can also tell you what to do, so keep the packet with you. I can't judge how serious this is."],
    [/\bsuicid|\b(?:kill|hurt|harm|cut)(?:ing)? my ?self\b|\bwant(?:ed)? to die\b|\bend(?:ing)? (?:my life|it all)\b|\bdon'?t want to (?:live|be alive)\b|\bbetter off (?:dead|without me)\b|\bself[- ]?harm/,
      "Thank you for telling me. I'm sorry you're carrying this. You deserve support from a person. Please tell someone you trust, and talk to a doctor, a counselor or a crisis line as soon as you can. If you might act on these thoughts, or you don't feel safe, contact your local emergency services now."],
    [/\bcan'?t go on\b|\bno point (?:anymore|in (?:anything|living))\b/,
      "I want to be sure I understand you. If any of that means you're thinking about hurting yourself, or about not wanting to be alive, please tell someone you trust right now, or contact a crisis line or your local emergency services. If it means things are very hard, that matters too, and you don't have to handle it alone."],
  ];
  function reply(text) {
    const said = String(text || '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').replace(NOT_SO, ' ');
    const found = SAID.find(row => row[0].test(said));
    return found ? found[1] + ' ' + PROGRAM + ' ' + NOBODY : '';
  }
  window.VeyeSafetyWords = { reply: reply };
})();
