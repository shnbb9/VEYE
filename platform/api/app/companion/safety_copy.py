"""What Sprout says when somebody may not be all right.

Fixed words, not a model's and not a console setting. They never diagnose,
never give an amount or first-aid instructions, never claim to be a clinician,
never say anybody is watching, and never give a telephone number unless the
country is known and the number has been checked.

ENGINEERING DRAFT, pending Cara's clinical and legal approval, like the decision
about who is told and how (see `distress.hand_over` and the escalation email).
Bump SAFETY_COPY_VERSION with any change: it is stored with every reply.
"""

from __future__ import annotations

from app.companion.distress import (
    CHECK_IN,
    IMMINENT,
    MEDICAL,
    OTHER,
    SELF,
    SELF_HARM,
    UNCLEAR,
    Assessment,
)

SAFETY_COPY_VERSION = "safety-2026-11-25-draft4"

NOT_WATCHED = "The team doesn't watch messages around the clock, so please don't wait for them."
PROGRAM = "I'm a program, not a clinician or a crisis service."
MARKED = "I've marked this conversation for the Veye team to read, but nobody is watching it around the clock, so please don't wait for them."

# ---- resources by country ------------------------------------------------------------
# VEYE records no country for a member, so nothing calls this with one today and
# the words stay general. An entry is added only once its numbers have been
# checked at their own source, with the date they were checked.
RESOURCES: dict[str, str] = {
    # 988, by call and by text: 988lifeline.org, read 25 Nov 2026. 911 is the
    # national emergency number; 911.gov refuses a program, so a person reads it
    # before any country is ever passed in.
    "US": "In the United States you can call or text 988 (Suicide & Crisis Lifeline), or call 911 in an emergency.",
}


def resources_for(country: str | None) -> str:
    """Only for a country that is explicitly known. Never guessed from a name,
    a time zone, an address or the way somebody writes."""
    return RESOURCES.get((country or "").strip().upper(), "")


# ---- may not be safe ------------------------------------------------------------------

_SELF_WORDS = {
    IMMINENT: ("I'm really glad you told me. Your safety comes first. Please contact your local emergency services now, or "
               "go to the nearest emergency department. If you can, tell someone near you and stay with them, and move "
               "away from anything you could use to hurt yourself."),
    SELF_HARM: ("Thank you for telling me. I'm sorry you're carrying this. You deserve support from a person. Please tell "
                "someone you trust, and talk to a doctor, a counselor or a crisis line as soon as you can. If you might act "
                "on these thoughts, or you don't feel safe, contact your local emergency services now."),
    CHECK_IN: ("I want to be sure I understand you. If any of that means you're thinking about hurting yourself, or about not "
               "wanting to be alive, please tell someone you trust right now, or contact a crisis line or your local emergency "
               "services. If it means things are very hard, that matters too, and you don't have to handle it alone."),
    MEDICAL: ("That could be a medical emergency. Please contact your local emergency services now, or ask someone near you to "
              "do it. If too much of a medicine, a supplement or anything harmful was taken, a poison information service can "
              "also tell you what to do, so keep the packet with you. I can't judge how serious this is."),
}
_OTHER_WORDS = {
    IMMINENT: ("Please act on this now. Contact your local emergency services, and if it's safe, stay with them until help "
               "comes."),
    SELF_HARM: ("It's good that you're looking out for them. If they may be in danger now, contact your local emergency services "
                "and stay with them if it's safe. Otherwise, listen, take what they say seriously, and help them reach someone "
                "they trust, a doctor or a crisis line. You don't have to carry this on your own either."),
    MEDICAL: ("That could be a medical emergency. Please contact your local emergency services now. If too much of a medicine, a "
              "supplement or anything harmful was taken, a poison information service can also tell you what to do, so keep the "
              "packet with you. I can't judge how serious this is."),
}
_OTHER_WORDS[CHECK_IN] = _OTHER_WORDS[SELF_HARM]

# Asking about the subject, long past, or not clearly anybody.
_INFORMATION = ("I can't help with that well, and I don't want to leave it there. If this is about you or someone near you, "
                "please talk to someone you trust, a doctor, a counselor or a crisis line. If anyone may be in danger now, "
                "contact your local emergency services.")
_MEDICAL_INFORMATION = ("I can't answer medical questions. If you or someone near you has those signs now, or has taken too much "
                        "of something, contact your local emergency services or a poison information service straight away. "
                        "Otherwise a doctor or a pharmacist is the right person to ask.")
_PAST_WORDS = ("Thank you for trusting me with that. I'm sorry you went through it. If any of it is close again, please talk to "
               "someone you trust, a doctor, a counselor or a crisis line, and if you don't feel safe, contact your local "
               "emergency services.")
_HARMED_WORDS = ("I'm sorry this is happening. Nobody should be hurt. If you're in danger now, please contact your local "
                 "emergency services, or go somewhere you feel safe. When you can, tell someone you trust, a doctor or a local "
                 "support service.")

# They may hurt somebody else.
_HARMING_WORDS = ("I'm really glad you told me. Please don't act on it. Move away from them if you can, and from anything that could be "
                  "used to hurt anyone, and contact your local emergency services or a crisis line now, so that everyone stays safe.")

# Said as well, when they are hurt by somebody and it is their own safety first.
_HURT_TOO = ("And nobody should be hurt. If you're in danger from someone now, go somewhere you feel safe if you can, or contact your "
             "local emergency services.")

# ---- hard, and not in danger ------------------------------------------------------------

ACKNOWLEDGE = {
    "anxious": "That sounds worrying, and it's okay to feel that way.",
    "sad": "I'm sorry it feels heavy right now.",
    "frustrated": "That sounds frustrating, and it's okay to feel that way.",
    "stressed": "That sounds like a lot to carry today.",
}
SUPPORT = ("You don't have to fix it all at once. A few slow breaths, a short walk, or telling someone you trust how today has "
           "been can help. You can also note how you feel in your Mood Tracker. If it keeps going, a doctor or a counselor is a "
           "good person to talk to.")
DISTRESS_WORDS = ("I'm sorry it feels this heavy, and I'm glad you said it. You don't have to handle it alone. Please tell someone "
                  "you trust how you're feeling, and talk to a doctor or a counselor about it.")
ASK_THE_TEAM = "If you'd like someone at Veye to read this, write to them from Contact Us on your dashboard."
GRIEF_WORDS = ("I'm so sorry. Losing someone is hard, and there's no right way to feel about it. Talking with someone you trust, or "
               "with a counselor, can help. You don't have to handle it alone.")
STEADIER = ("I'm glad you're all right, and thank you for saying so. If that changes, please talk to someone you trust, a doctor or "
            "a crisis line, and if you don't feel safe, contact your local emergency services.")
STILL_HERE = ("I'm still here. I can't help with that one, and if things feel heavy again, please talk to someone you trust, a doctor "
              "or a crisis line. If you don't feel safe, contact your local emergency services.")
# The rules saw nothing and the second reading was not easy about it: asked,
# where the question was outside what Sprout can help with, or said after an
# ordinary answer. Nobody is told, and the words do not say anybody will be.
UNSURE_QUESTION = ("I'm not sure I understood you, and I'd rather ask than guess. Are you thinking about hurting yourself or not being here, "
                   "or is someone hurt, unwell or in danger? If so, please contact your local emergency services now, or tell someone "
                   "near you, and you can tell me in a few plain words. If it's something else, I'm sorry, I can't help with that one.")
UNSURE_LINE = ("If any of that was about not feeling safe, or about someone who needs help, please tell someone you trust, or contact "
               "your local emergency services.")
# Said after the approved hand-over words for a medical question.
MEDICAL_CARE = "If you feel unwell now, please contact a doctor or your local emergency services."


def urgent_words(assessment: Assessment, *, marked: bool, country: str | None = None) -> str:
    """The reply when somebody may not be safe. `marked` says whether the
    conversation really was marked for the team: the words claim nothing else."""
    if assessment.harming:
        words = _HARMING_WORDS
    elif assessment.harmed:
        words = _HARMED_WORDS
    elif assessment.about == UNCLEAR:
        words = _MEDICAL_INFORMATION if assessment.level == MEDICAL else _INFORMATION
    elif assessment.past:
        words = _PAST_WORDS
    elif assessment.about == OTHER:
        words = _OTHER_WORDS[assessment.level]
    else:
        assert assessment.about == SELF
        words = _SELF_WORDS[assessment.level]
    return " ".join(part for part in (words, _HURT_TOO if assessment.hurt else "", resources_for(country), PROGRAM, MARKED if marked else "") if part)


def distress_words(assessment: Assessment) -> str:
    """Heavy, with no sign of danger, and not handed to anybody."""
    if assessment.about == OTHER:
        return f"{GRIEF_WORDS} {ASK_THE_TEAM}"
    return f"{DISTRESS_WORDS} {ASK_THE_TEAM}"
