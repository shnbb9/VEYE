/* The last line, for when Sprout cannot be reached at all.
 *
 * Whether somebody may not be safe is the API's to decide, with far more care
 * than this (app/companion/distress.py). These few words only choose what a
 * failed send says: somebody who typed one of them is not left with "please
 * try again". Nothing here is sent, stored or shown to anybody else. */

const WORDS = /suicid|\b(?:kill|hurt|harm)(?:ing)? my ?self\b|\bend(?:ing)? (?:my life|it all)\b|\bwant(?:ed)? to die\b|\bself[- ]?harm|\boverdos|\btook too many\b|\bcan'?t breathe\b|\bchest pain/i;

export const URGENT_UNREACHABLE =
  "If you may not be safe, please contact your local emergency services now, or tell someone near you.";

export const soundsUrgent = (text: string) => WORDS.test(text.replace(/[\u2018\u2019]/g, "'"));
