"""Is this person all right? Asked of every message before anything else.

Plain rules over the member's own words. No model takes part, so it answers the
same way when the model is unavailable, switched off, rate limited or talked
round. It decides how worried to be, about whom, and nothing else: what is said
back is `safety_copy.py`, and who is told is `service.py`.

  feelings           sad, anxious, stressed, frustrated, lonely: ordinary, and not danger
  distress           heavier, with no sign of danger
  unsure             nothing above was said, and it still may be meant (`second_reading.py`)
  check_in           could mean not wanting to be alive, could not
  self_harm          thoughts of suicide or self-harm, or asking how
  medical_emergency  too much medicine, or a body that needs help now
  imminent           a plan, the means, a time, or it has started

Erring is one-sided on purpose: a worrying phrase is only set aside when it is
plainly something else (a saying, a song, "I'm not suicidal"). Rules cannot
catch every way of saying this, and nothing here claims to: it is the floor, in
English, and the sentences it is held to are in `tests/test_distress.py` and
`tests/contracts/safety_sentences*.json`, written by somebody who had not seen
these rules. Said sideways ("I won't be needing the plan after Friday") is where
they are weakest, and the tests say by how much.

ENGINEERING DRAFT: which phrases belong to which level is a clinical question
and is Cara's to approve.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, replace

from app.companion import second_reading

NONE, FEELINGS, DISTRESS, UNSURE = "none", "feelings", "distress", "unsure"
CHECK_IN, SELF_HARM, MEDICAL, IMMINENT = "check_in", "self_harm", "medical_emergency", "imminent"
RANK = {NONE: 0, FEELINGS: 1, DISTRESS: 2, UNSURE: 3, CHECK_IN: 4, SELF_HARM: 5, MEDICAL: 6, IMMINENT: 7}

SELF, OTHER, UNCLEAR = "self", "other", "unclear"


@dataclass(frozen=True)
class Assessment:
    level: str = NONE
    about: str = SELF
    # It is over: not a danger now.
    past: bool = False
    # Somebody is hurting them, rather than they themselves.
    harmed: bool = False
    # And somebody is hurting them.
    hurt: bool = False
    feeling: str | None = None
    # They said they are all right, soon after they were not.
    steadier: bool = False
    # The message without the parts that were plainly something else.
    residual: str = ""
    # Nothing worrying was said, and the second reading is not easy about it.
    # Never a reason to tell anybody: only to ask, or to add a line.
    unsure: bool = False
    # Somebody else is who may be hurt, and by them.
    harming: bool = False

    @property
    def urgent(self) -> bool:
        return RANK[self.level] >= RANK[CHECK_IN]

    @property
    def hand_over(self) -> bool:
        """Does a person on the Veye team get told? Somebody at risk now, the
        member or somebody they are worried about. Not a question about the
        subject, something long past, or what another person does to them: that
        is theirs to tell."""
        return self.urgent and self.about != UNCLEAR and not self.past and not self.harmed


# ---- reading the words ------------------------------------------------------------

_LOOKALIKES = str.maketrans({"а": "a", "е": "e", "о": "o", "с": "c", "і": "i", "ѕ": "s", "к": "k", "м": "m", "т": "t",
                             "у": "y", "х": "x", "р": "p", "ɑ": "a", "ο": "o", "ӏ": "l", "ᴀ": "a", "ʙ": "b", "ᴄ": "c", "ᴅ": "d", "ᴇ": "e", "ꜰ": "f",
                             "ɢ": "g", "ʜ": "h", "ɪ": "i", "ᴊ": "j", "ᴋ": "k", "ʟ": "l", "ᴍ": "m", "ɴ": "n", "ᴏ": "o", "ᴘ": "p", "ʀ": "r", "ꜱ": "s",
                             "ᴛ": "t", "ᴜ": "u", "ᴠ": "v", "ᴡ": "w", "ʏ": "y", "ᴢ": "z"})
_LEET = str.maketrans("0345789@$!|€", "oeastbgasile")
_LEET_MARKS = re.compile(r"[\d@$!|€]")
_PICTURES = {"\u2620": " kill ", "\U0001F52A": " cut ", "\U0001F5E1": " cut ", "\U0001FA78": " blood ",
             "\U0001F52B": " gun ", "\U0001F48A": " pills ", "\u26B0": " death ", "\U0001FAA6": " death "}

# How people type, one word at a time. Words only, never parts of words.
_TYPED = {
    "2nite": "tonight", "2night": "tonight", "2nyt": "tonight", "tonite": "tonight", "tnight": "tonight", "nite": "night", "2day": "today",
    "2moro": "tomorrow", "2morrow": "tomorrow", "tmrw": "tomorrow", "tmr": "tomorrow", "tomoro": "tomorrow", "4ever": "forever", "4eva": "forever",
    "foreva": "forever", "nemore": "anymore", "anymor": "anymore", "anymre": "anymore", "b": "be", "r": "are", "u": "you", "ur": "your", "n": "and",
    "bc": "because", "cuz": "because", "coz": "because", "cos": "because", "rn": "right now", "idk": "i don't know", "idc": "i don't care",
    "imma": "i'm going to", "ima": "i'm going to", "gna": "going to", "gonna": "going to", "gunna": "going to", "gona": "going to", "finna": "going to",
    "goin": "going", "tryna": "trying to", "wanna": "want to", "wana": "want to", "wna": "want to", "wnna": "want to", "wnt": "want", "wnat": "want",
    "wuz": "was", "woz": "was", "ded": "dead", "dun": "don't", "dnt": "don't", "dont": "don't", "cnt": "can't", "cant": "can't", "cannot": "can't",
    "wont": "won't", "didnt": "didn't", "doesnt": "doesn't", "isnt": "isn't", "wasnt": "wasn't", "werent": "weren't", "havent": "haven't", "hasnt": "hasn't",
    "hed": "he'd", "couldnt": "couldn't", "wouldnt": "wouldn't", "shouldnt": "shouldn't", "aint": "isn't", "im": "i'm", "iam": "i'm", "ive": "i've", "id": "i'd",
    "hes": "he's", "shes": "she's", "theyre": "they're", "theyll": "they'll", "youre": "you're", "whats": "what's", "thats": "that's", "theres": "there's",
    "itll": "it'll", "its": "it's", "liv": "live", "lyfe": "life", "lyf": "life", "lfe": "life", "lif": "life", "kep": "keep", "saef": "safe", "tuk": "took",
    "pils": "pills", "pillz": "pills", "jus": "just", "jst": "just", "smthn": "something", "smth": "something", "sumthin": "something", "sumthing": "something",
    "alot": "a lot", "dissapear": "disappear", "disapear": "disappear", "dissappear": "disappear", "hav": "have", "ppl": "people", "sum1": "someone",
    "some1": "someone", "any1": "anyone", "every1": "everyone", "no1": "nobody", "bf": "boyfriend", "gf": "girlfriend", "hubby": "husband",
    "bestie": "best friend", "yrs": "years", "yr": "year", "mos": "months", "wks": "weeks", "hrs": "hours", "mins": "minutes", "breth": "breathe",
    "breethe": "breathe", "chset": "chest", "docter": "doctor", "ovrdosed": "overdosed", "ovrdose": "overdose", "overdosd": "overdosed", "lonley": "lonely",
    "deppressed": "depressed", "depresed": "depressed", "sewerslide": "suicide", "sewicidal": "suicidal", "unalived": "unalive", "cuttin": "cutting",
    "killin": "killing", "hurtin": "hurting", "dyin": "dying", "livin": "living", "wakin": "waking", "feelin": "feeling", "thinkin": "thinking",
    "sh'd": "self-harmed", "srry": "sorry", "sumbody": "somebody", "tierd": "tired", "evrything": "everything", "cnat": "can't", "throte": "throat", "swalow": "swallow",
    "dizy": "dizzy", "tok": "took", "meny": "many", "hrt": "hurt", "wantd": "wanted", "sui": "suicide",
    "cuting": "cutting", "cutin": "cutting", "cutn": "cutting", "cutt": "cut", "cutted": "cut", "kiill": "kill", "kkill": "kill", "kilin": "killing", "rist": "wrist", "rists": "wrists",
    "tomorow": "tomorrow", "tommorow": "tomorrow", "tommorrow": "tomorrow", "rihgt": "right", "wrogn": "wrong", "comming": "coming", "w": "with", "til": "until", "thru": "through",
    "soo": "so", "noo": "no", "yess": "yes", "yesh": "yes", "beter": "better", "bettr": "better", "reson": "reason", "lief": "life", "wanto": "want to", "wantto": "want to", "wan2": "want to",
    "want2": "want to", "gon": "going to", "goung": "going", "breathin": "breathing", "brethe": "breathe", "breth ": "breathe", "breating": "breathing", "breateh": "breathe", "pian": "pain",
    "bleding": "bleeding", "bleedin": "bleeding", "chocking": "choking", "unconcious": "unconscious", "unconsious": "unconscious", "concious": "conscious", "seizure's": "seizure's", "siezure": "seizure",
    "seazure": "seizure", "collapesd": "collapsed", "colapsed": "collapsed", "pils'": "pills", "tabelts": "tablets", "overdoze": "overdose", "no1s": "nobody's", "kil": "kill", "kll": "kill", "klil": "kill", "kiling": "killing", "miself": "myself", "meself": "myself", "mself": "myself", "mysef": "myself",
    "nobodys": "nobody's", "noones": "nobody's", "tonights": "tonight's", "everyones": "everyone's", "wouldve": "would have", "couldve": "could have",
    "wholl": "who'll", "theyd": "they'd", "missus": "wife", "mysel": "myself", "myslef": "myself", "mysefl": "myself", "myseld": "myself", "mysellf": "myself", "selfharm": "self-harm", "s/h": "self-harm",
}
# One spelling for each thing, so the rules below are written once.
_SPELLINGS = [(re.compile(pattern), replacement) for pattern, replacement in (
    (r"\bwant(?:s|ed|ing)? (?:too|2|ot|tae)\b", "want to"), (r"\bplan 2\b", "plan to"), (r"\bgoing 2\b", "going to"), (r"\bgoing to to\b", "going to"),
    (r"\b2(?= (?:end|die|stop|be|go|hurt|kill|live|do)\b)", "to"), (r"\b(took|take|taken|ate|had|swallowed) to (many|much)\b", r"\1 too \2"), (r"\bcan not\b", "can't"), (r"\bdo not\b", "don't"), (r"\bdid not\b", "didn't"), (r"\bdoes not\b", "doesn't"), (r"\bwill not\b", "won't"),
    (r"\bwould not\b", "wouldn't"), (r"\bhave not\b", "haven't"), (r"\bis not\b", "isn't"), (r"\bwas not\b", "wasn't"), (r"\bwere not\b", "weren't"),
    (r"\bi am\b", "i'm"), (r"\bi will\b", "i'll"), (r"\bi would\b", "i'd"), (r"\bmy slef\b|\bmy self\b|\bme self\b", "myself"),
    (r"\b(kill|hurt|harm|cut|hang|shoot)myself\b", r"\1 myself"), (r"\bendmylife\b", "end my life"), (r"\b(?:iwantto|wantto)die\b", "want to die"),
    (r"\bwant to (?:dei|dy|diee+|dieing|dye)\b(?! my| hair| the| it| some)", "want to die"), (r"\bdie ?\(t", "diet ("), (r"\bsewer slide\b", "suicide"),
    (r"\bself+[ -]?(?:ha?r+m|hram)", "self-harm"), (r"\b(?:any more|no more longer)\b", "anymore"), (r"\bover ?do(?:s+|z+)e", "overdose"),
    # letters and words run together, or held apart by a mark
    (r"\b(kill|killing|hurt|hurting|harm|harming|cut|cutting|hang|hanging|shoot|end|unalive|delete)[-_./\\]+ ?(my ?sel\w+)\b", r"\1 \2"), (r"\b\w*killmyself\w*\b", "kill myself"),
(r"\b\w*wan(?:t(?:to|2)?|2|na)die\w*\b", "want to die"), (r"\b\w*endmylife\w*\b", "end my life"), (r"\bsui[ -]cid", "suicid"), (r"\byour self\b", "yourself"), (r"\bun-aliv", "unaliv"),
    (r"\bmy (?:slef|sefl|sellf|selff)\b|\bmys+e?l+f+s?\b(?<!myself)", "myself"), (r"\bwan to\b|\bwant tot\b|\bwan(?:t|na) 2\b", "want to"), (r"\b(i|i'd|just|really|so|still) want die\b", r"\1 want to die"),
    (r"\bend(ing)? (it|me) al\b", r"end\1 \2 all"), (r"\bend(ing)? mylife\b", r"end\1 my life"),
    # "OD" is once a day, an optometrist, and an overdose: only where somebody does it
    (r"\bo\.?d'?(?:'?e?d|s'd)\b", "overdosed"), (r"\bo\.?d'?ing\b", "overdosing"), (r"\b(i|to|will|might|could|would|just|and|or|almost|nearly|going to|gonna|i'll|he|she|they|friends?|people) od\b(?! (?:appointment|visit|exam|doctor)\b)", r"\1 overdose"), (r"\bod on\b", "overdose on"),
    (r"\bill(?= (?:be|still|not|never|do|go|just|kill|hurt|end|always|ever|die)\b)", "i'll"),
    (r"\bhell(?= (?:kill|hurt|hang|shoot|do it|end))", "he'll"), (r"\bshell(?= (?:kill|hurt|hang|shoot|do it|end))", "she'll"),
    (r"\bwant to die(?=d\b)", "want to die "),
)]
_SPACED = re.compile(r"(?<![a-z0-9'])(?:[a-z0-9@$!][^a-z0-9@$!']){2,}[a-z0-9@$!](?![a-z0-9'])")
_STARRED = re.compile(r"(?<![a-z*])[a-z]*\*[a-z*]*(?![a-z*])")
_STARRED_WORDS = ("suicide", "suicidal", "kill", "killing", "die", "dead", "overdose", "myself", "harm", "hurt", "cut", "cutting", "hang", "dying")
# Ordinary words one or two letters from "suicide".
_NOT_SUICIDE = frozenset({"subside", "subsides", "subsided", "subsiding", "subsidy", "sulfide", "sulfides", "sulphide", "suicide", "suicides", "suicidal",
                          "stupid", "squid", "solid", "salicide", "suction", "suited", "studied", "soccer"})


def normalise(message: str) -> str:
    """Lower case, single spaces, and the same letter however it was typed: a
    phone types can’t, and an invisible character inside a word is not a
    different word."""
    # One sign that stands for a whole sentence is not how anybody types one.
    text = "".join(ch if len(unicodedata.normalize("NFKC", ch)) < 5 else " " for ch in message or "")
    text = unicodedata.normalize("NFKC", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Cf").lower()
    for mark in ("‘", "’", "ʼ", "´", "`"):
        text = text.replace(mark, "'")
    return " ".join(text.split())


def _distance(a: str, b: str, limit: int) -> int:
    """Letters added, dropped, changed or swapped, up to a limit."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    rows = [list(range(len(b) + 1))]
    for i, ca in enumerate(a, 1):
        row = [i]
        for j, cb in enumerate(b, 1):
            cost = min(rows[-1][j] + 1, row[j - 1] + 1, rows[-1][j - 1] + (ca != cb))
            if i > 1 and j > 1 and ca == b[j - 2] and a[i - 2] == cb:
                cost = min(cost, rows[-2][j - 2] + 1)
            row.append(cost)
        rows.append(row)
    return rows[-1][-1]


def _unmask(match: re.Match) -> str:
    shape = re.compile("^" + "".join("." if ch == "*" else ch for ch in match.group(0)) + "$")
    return next((word for word in _STARRED_WORDS if shape.match(word)), match.group(0))


def _unleet(word: str, one: str) -> str:
    core = word.rstrip("!?.,")
    if not (re.search("[a-z]", core) and _LEET_MARKS.search(core)) or re.fullmatch(r"\d+[a-z]{1,3}", core):
        return word                                     # "20s", "5k", "10am" are what they say
    return core.translate(_LEET).replace("1", one) + word[len(core):]


def _spell(text: str) -> str:
    text = re.sub(r"\bk[il1|!]{2,4}(?=(?:s|ed|ing)?\b)", "kill", text)
    # "killl", "sooo", "diiie"
    text = re.sub(r"([a-z])\1{2,}", lambda m: m.group(1) * (2 if m.group(1) in "eolsf" else 1), text)
    text = re.sub(r"(?<=\w)\.{2,}", ", ", text)          # trailing off is not a full stop
    words = []
    for word in text.split(" "):
        bare = word.strip(".,!?;:\"()")
        if bare in _TYPED:
            word = word.replace(bare, _TYPED[bare])
        elif 6 <= len(bare) <= 10 and bare[0] == "s" and (bare[1] == "u" or re.search("[cs][iye]*d", bare)) and bare not in _NOT_SUICIDE:
            for target in ("suicide", "suicidal"):
                if _distance(bare, target, 2) <= 2:
                    word = word.replace(bare, target)
                    break
        words.append(word)
    text = " ".join(words)
    for pattern, replacement in _SPELLINGS:
        text = pattern.sub(replacement, text)
    return text


def forms(message: str) -> list[str]:
    """The message as written, and as it reads once the usual disguises are
    undone: look-alike letters, digits for letters, s p a c e d letters, st*rs,
    and the pictures people use instead of the words."""
    plain = normalise(message)
    # A skull is laughing, unless somebody does it to somebody.
    pictured = re.sub("\U0001F480+(?= ?(?:my ?self|me\\b))|(?<=to )\U0001F480+|(?<=gonna )\U0001F480+", " kill ", plain)
    for picture, word in _PICTURES.items():
        pictured = pictured.replace(picture, word)
    stripped = "".join(ch for ch in unicodedata.normalize("NFKD", pictured) if not unicodedata.combining(ch)).translate(_LOOKALIKES)
    stripped = " ".join(stripped.split())
    joined = _SPACED.sub(lambda m: re.sub(r"[^a-z0-9@$!]", "", m.group(0)), stripped)
    out = [plain, stripped, joined, _STARRED.sub(_unmask, joined)]
    for one in ("i", "l"):
        out.append(" ".join(_unleet(word, one) if word not in _TYPED else word for word in joined.split(" ")))
    seen: list[str] = []
    for text in out:
        text = _spell(text)
        if text not in seen:
            seen.append(text)
    return seen


def _rules(*patterns: str) -> list[re.Pattern]:
    return [re.compile(pattern) for pattern in patterns]


# ---- what is plainly something else -------------------------------------------------

# Names and things that only sound like it: each is one thing whatever stands
# beside it, so it is taken out before anything is read.
_TITLES = re.compile("|".join((
    r"\bto kill a mockingbird\b", r"\bkill bill\b", r"\bkilling eve\b", r"\b(?:the )?walking dead\b", r"\bdie hard(?: \d)?\b(?! (?:to|trying)\b)", r"\b(?:a )?million ways to die in the west\b", r"\bdumb ways to die\b",
    r"\bhow to die alone\b(?= (?:is|was|on|season|show))", r"\b(?:13|thirteen) reasons why\b", r"\bsuicide squad\b", r"\bromeo and juliet\b", r"\bthelma and louise\b", r"\bmanchester by the sea\b", r"\bdead poets society\b", r"\ba star is born\b",
)))
_NAMES = re.compile("|".join((
    r"\bday of the dead\b", r"\bold habits die hard\b", r"\b(?:sugar|carb|caffeine|chocolate|candy|food|cheese|turkey|tv|cuteness|information|sodium|salt|bread) overdoses?\b", r"\bdead(?:heads?|lift\w*)\b|\bdead (?:bugs?|lifts?|hangs?|sea|space|end|line|heat|weight|ahead|last)\b",
    r"\bsuicide (?:silence|girls?|boys?|king|queen|grips?|doors?|sprints?|runs?|drills?|wings?|burger|sauce|hot|lanes?|awareness|bomb\w*|rates?|statistics|stats|research|stud(?:y|ies)|epidemic|scene|clean-?up|watch (?:shift|duty))\b|\bsuicide prevention\b(?! (?:hot ?line|help ?line|line|lifeline|number)\b)",
    r"\b(?:career|political|social|fashion|dietary|professional) suicide\b", r"\b(?:jump|jumping|skip|skipping|battle|climbing|tow) ?ropes?\b", r"\bknife skills\b", r"\bbulletproof coffee\b", r"\bpaper cuts?\b", r"\b(?:glute|hip|dental|land|foot|hamstring) bridges?\b|\bbridge (?:pose|exercise|club|loan|game|night)\b",
    r"\b(?:fasting|eating|feeding|time|pop-?up|browser|delivery) windows?\b", r"\b(?:flu|covid|vitamin|b ?12|allergy|booster|tetanus|shingles|espresso|ginger|tequila|wheatgrass|photo|three[- ]point) shots?\b", r"\bdy(?:e?ing|e) (?:my |her |his |the |our |some )?(?:hair|eyebrows|beard|roots|shirts?|easter eggs|eggs|clothes|fabric|wool|yarn)\b",
    r"\b(?:almost|nearly) killed it\b|\bkilled it\b", r"\bdrop dead gorgeous\b", r"\bdead (?:tired|serious|set|on my feet|simple|easy|wrong|right)\b", r"\bdeath by chocolate\b", r"\bdeath warmed (?:up|over)\b|\b(?:look|looks|felt|feel|feels) like death (?:on|warmed|after)\b", r"\b(?:will|would|is going to|gonna) be the death of me\b",
    r"\b(?:the )?circle of life\b", r"\bkiller (?:workout|recipe|abs|deal|instinct|bees?|whales?|app|feature|heels|boots|legs)\b", r"\bselling? my (?:soul|kidney) for\b|\bsell my (?:soul|kidney)\b",
    r"\bkill(?:er|ing|ed|s)? (?:two birds|time|off|bacteria|germs|weeds|mold|mould|parasites?|salmonella|e\.? ?coli|yeast|zombies|mosquito\w*|bugs|ants|mice|chickens?|the (?:mood|vibe|taste|germs|bacteria|weeds|yeast|workout|flavou?r|bitterness|garden|mold|mould|smell|buzz|momentum|enzymes|vitamins|nutrients|probiotics|parasites?|game|boss|zombies|competition|presentation|lights|engine)|my (?:appetite|cravings?|hunger|diet|motivation|vibe|knees?|back|feet|legs?|metabolism|battery|phone|sleep|buzz|plants?|houseplants?|mood|gains|progress)|(?:the |my )?gut)\b",
    r"\b(?:in|the) dead of (?:winter|night)\b", r"\bsuicides\b(?=[^.?!]*\b(?:drills?|court|gym|practice|laps|sets?|reps|sprints?|coach|basketball)\b)|\b(?:did|do|doing|ran|run|running) (?:(?:\d+|some|ten|a few|these|those|our) )?suicides\b",
)))

_JOKING = re.compile(r"\b(?:lol+|lmao+|lmfao|rofl|haha+|hehe+|jk)\b|[\U0001F602\U0001F923\U0001F606\U0001F605\U0001F480]")
# What an overdose is of. Anything else is a saying ("overdosed on cheese").
_DRUGS = (r"pills?|tablets?|capsules?|meds|medications?|medicines?|drugs?|insulin|metformin|paracetamol|acetaminophen|tylenol|ibuprofen|advil|aleve|aspirin|antidepressants?|painkillers?|opioids?|opiates?|oxy\w*|percocet|vicodin|codeine|morphine|fentanyl|heroin|cocaine|meth|xanax|valium|ativan|klonopin|ambien|benadryl|"
          r"sleeping|statins?|warfarin|blood thinners?|beta blockers?|thyroid|antihistamines?|sedatives?|benzos?|purpose|them|it|everything|something|stuff|whatever")
_PEOPLE = r"(?:him|her|them|you|my (?:husband|wife|partner|mom|mum|mother|dad|father|son|daughter|baby|brother|sister|boyfriend|girlfriend|kids|family))"
_NOT_LIFE = (r"(?!(?:on )?(?:my |the |this |that )?(?:own )?(?:life|lives|living|being (?:alive|here)|myself|me|everything|everyone|it all|hope|all hope|trying|anymore|now|completely|entirely|already|and|but|because|so|too|then|or|on (?:life|living|everything|it all))\b)")
_LONG = r"(?:real|good|nothing|no reason|sure|once|everyone|him|her|them|myself|years|months|weeks|days|ages|so long|as long|a (?:while|long|few)|the (?:last|past|longest))"

_SAYINGS = _rules(
    rf"(?<!want )(?<!wants )(?<!wanted )(?<!wanting )(?<!ready )(?<!going )(?<!need )(?<!like )(?<!hope )(?<!hoping )(?<!deserve )(?<!used )\bto die for\b(?! {_LONG}\b)", rf"(?<!of )(?<!about )\bdying (?:to|for)\b(?! (?:be dead|kill myself|{_LONG})\b)",
    r"\b(?:(?:scared|bored|worried|worked|working|working myself|loved?|loves?|sick|frozen|freezing|tickled|riding me|amused|starved|starving|sweating|annoyed|pestered)(?: (?!myself)\w+)?) to death\b|\bcatch my death\b|\bworking myself to death\b|\bworking me to death\b|\bliterally starving\b",
    r"\b(?:(?:my|the|this|that|these|those|your|our) )?(?!chest\b|heart\b|he\b|she\b)[\w']+ (?:is|are|was|were|been|keeps?|kept) (?:\w+ )?killing me\b", r"\b(?:it's|that's|you're) killing me\b", r"\bkill(?:s|ed)? me (?:that|how|every time|laughing|smalls)\b", r"\b(?!god\b|please\b|someone\b|somebody\b)[a-z]+s (?:just |really )?kill me\b",
    r"\b(?:kill|shoot) me now\b", r"^(?:just |please |someone )?(?:kill|shoot|end) me\b(?=[^.?!]*\b(?:i (?:ate|skipped|forgot|missed|had)|again|salad|kale|diet|leg day|monday|meeting|cake|lol)\b)", r"\bput me out of my misery\b",
    r"\b(?:almost|nearly) killed me\b(?=[^.?!]*\b(?:yoga|class|marathon|hill|stairs|workout|run|hike|burpees|leg day|spin)\b)|\b(?:yoga|class|marathon|hill|stairs|workout|run|hike|burpees|leg day|spin)\b[^.?!]{0,30}\b(?:almost |nearly )?killed me\b",
    r"\b(?:almost|nearly) had a (?:heart attack|stroke)\b", r"\b(?:total |complete |a )?hopeless case\b", r"\buseless (?:at|with|in the|before)\b", r"\b(?:i'd|could|would|i'll) (?:kill|murder|die) for\b(?! (?:him|her|them|good|real|you|my (?:kids|son|daughter|family))\b)", r"\bcould (?:kill|murder) (?:a|an|some|this|that|for|the) \w+",
    r"\bkill(?:ing|ed)? myself (?:laughing|over (?:this|the|a|my|these|one|some|every) (?:\w+ )?(?:diet|workouts?|cookies?|projects?|deadlines?|homework|essay|exam|test|spreadsheet|report|presentation|budget|recipe|meal|meal prep|macros|calories|carbs|steps|scale|numbers?|score|points?|game|puzzle|wedding|party|kitchen|garden|house|taxes|slice|bite|donut|cupcake|pound)s?|(?:at|in) (?:the )?(?:gym|class|training|yoga|spin|crossfit|pool|studio)|on (?:the|my) (?:treadmill|bike|elliptical|rower|stairs?|peloton|spin bike)|with (?:work|overtime|exercise|workouts?|cardio|these workouts|all (?:this|these) \w+)|"
    r"trying to (?:lose|get (?:fit|in shape|thin|healthy|it (?:all )?done|everything done)|keep up|finish|make (?:ends meet|it work)|meet)|to (?:finish|lose (?:weight|the weight|fat)|stay (?:in shape|fit)|get (?:fit|in shape|it done|this done)|make (?:ends meet|the deadline)|meet (?:the|a|my|our|this) (?:\w+ )?(?:deadline|goal|target|numbers?|quota)))\b", r"\b(?:i'm|i've been|been|am|was) killing myself at work\b(?! (?:tomorrow|tonight|today)\b)",
    r"\b(?:kick|beat|pinch)(?:ing|ed)? myself(?: up)?\b", r"\bsho(?:o|)t(?:ing)? myself in the foot\b", r"\bhurt(?:ing)? myself laughing\b", r"\bjump(?:ing)? off a (?:cliff|bridge) for (?:a|an|some|that)\b", r"\bhang(?:ing)? myself upside down\b|\bhung myself up on\b", r"\bdrown(?:ing|ed)? myself in (?:water|work|coffee|tea|emails?|ice cream|chocolate|wine)\b", r"\b(?:punish|punishing) myself with (?:\w+ )?(?:cardio|exercise|workouts?|salads?|running|the gym)\b",
    r"\bcut(?:ting)? myself (?:off|some slack|a (?:slice|piece|break|deal|bit of (?:slack|cake|pie|cheese|bread))|short|down)\b", r"\bburn(?:ing|ed|t)? myself out\b", r"\b(?:end(?:ing)?|delet(?:e|ing)) myself(?= (?:up|a|the|from|off the (?:list|app)))",
    r"\b(?:die|died|dying) (?:of|from) (?:embarrassment|laughter|laughing|boredom|shame|cringe|cuteness|heat|thirst|hunger|happiness)\b", r"\b(?:nearly|almost|just|literally|could have|could've) died (?:laughing|of|when|from|on (?:that|the|my))\b",
    r"\b(?:rather|sooner) die than\b(?! (?:live|wake|keep|go on|carry on|face|be (?:alive|here|like this)|continue|stay|exist|do this|feel|spend another|see another|have to live)\b)", r"\bdie happy\b", r"\bi'm (?:dead|deceased|dying)\b(?=[^.?!]*(?:\b(?:lol|lmao|haha|funny)\b|[\U0001F602\U0001F923]))",
    r"\b(?:i'll|going to|i could|might|would|i'd) (?:literally |just |actually )?die (?:if|without|unless) (?!(?:him|her|them|you)\b)", r"\bnot (?:actually|really|literally) (?:dying|dead)\b", rf"\bcan't live without (?!{_PEOPLE}\b)(?:my |the |a )?\w+", r"\b(?:life|it) (?:isn't|not|'s not) worth (?:living|it) (?:without|if i can't (?:have|eat))\b(?! (?:him|her|them|you|my (?:husband|wife|son|daughter|mom|mum|dad|partner))\b)|\blife without \w+ isn't worth living\b",
    r"\bend my life ?-?long\b", r"\btak(?:e|es|ing) (?:my|his|her|their) life (?:back|seriously|more seriously|in (?:a |an )?(?:new|better|different|another|positive|healthier|good|whole new|right|the right) ?(?:direction|path|way)?|in(?:to)? (?:my|his|her|their) own hands|to (?:the next|a new|another) level|forward|one (?:day|step) at a time|off (?:hold|pause))\b",
    r"\b(?!i\b|i'll\b|i'd\b|tonight\b|and\b|he\b|she\b)[a-z']+ (?:will|could|might|would|may|can|is going to|almost|nearly) take my life\b",
    r"\b(?:make|makes|made|making) me want to (?:die|kill myself|scream)\b(?=[^.?!]*(?:lol|lmao|haha|jk|\U0001F602|\U0001F923))", r"\bwanted to die when i (?:ripped|dropped|tripped|spilled|farted|burped|saw (?:the|my) (?:scale|bill|photo)|fell)\b", r"\bfe(?:lt|el|els) like (?:i was )?dying (?:after|during|on|in)\b", r"\bthought i (?:was going to|would|might|'d) die (?:in|on|during|at|of)\b(?=[^.?!]*\b(?:yoga|class|run|hike|workout|gym|embarrass\w+|laughter|heat|flu|spin)\b)",
    r"\bif (?:it|this|today|tomorrow) (?:was|were) (?:my|the|your) last (?:day|night|meal)\b(?: on earth| alive)?", r"\b(?:with a |holding a )?gun to my head,? (?:i'd|i would|which|what|choose)\b|\b(?:if (?:you|someone|they) (?:put|held)|you (?:could|can) (?:put|hold)) a gun to my head\b", r"\bend(?:ing)? (?:it|this|things)\W{0,4}(?:the|my|this) (?:fast|diet|membership|subscription|trial|plan|program|challenge|streak|cleanse|lease)\b", rf"\bcan't go on without (?!{_PEOPLE}\b)(?:my |the |a )?\w+", r"^(?=.*\b(?:cancel\w*|membership|subscription|refund|trial|lease)\b).*\bend(?:ing)? (?:it|things)\b(?: (?:today|tonight|now|soon|all|early|tomorrow|this week))?", r"\b(?:just shoot|shoot) me\b", r"\b(?:my (?:mom|mum|mother|wife|husband|boss|trainer|coach|dentist|doctor|teacher|sister|friend|kids|partner|boyfriend|girlfriend|\w+)|he|she|they)(?:'s| is|'ll| will|'d| would| might)? ?(?:going to |gonna )?kill me (?:if|when) (?:i (?:eat|ate|don't|didn't|forget|forgot|miss|missed|skip|skipped|buy|bought|spend|spent|bring|brought|show|cancel\w*|cook|order|gain|lose|touch|drink|drank|finish|finished|put|track|use|used)|i'm late|i was late|(?:he|she|they) sees? (?:the|my|this) (?:bill|credit card|scale|kitchen|mess|receipt))\b", r"\bover my dead body\b", r"\bdead to me\b", r"\bbeating a dead horse\b", r"\b(?:gave|give|giving|nearly gave|almost gave) me a heart attack\b", r"\bheart attack on a plate\b", r"\bstroke of\b", r"\b(?:keep|kept) dying (?:on|in|at) (?:level|the (?:boss|game|same))\b",
    r"\bso (?:hung ?over|full|cold|hot|bored|embarrassed|sore|hungry|jet ?lagged|sunburn(?:ed|t)) (?:that )?i (?:want(?:ed)? to|could|might|am going to|'m going to) die\b",
    r"(?<=so anxious )(?:that )?i can't breathe\b|(?<=so nervous )(?:that )?i can't breathe\b|(?<=so stressed )(?:that )?i can't breathe\b|(?<=so scared )(?:that )?i can't breathe\b|(?<=so excited )(?:that )?i can't breathe\b|(?<=so full )(?:that )?i can't breathe\b", r"\b(?:so full|too full|laughing|laughed) (?:\w+ ){0,3}(?:that )?i (?:can't|couldn't) breathe\b", r"\bcouldn't breathe (?:from )?laughing\b", r"\bcan't breathe (?:in|during|with|through) (?:yoga|these|this|the|my|a|that) (?:\w+ )?(?:twists?|pose|class|jeans|dress|mask|belt|pants|costume|corset|bra|spanx|nose)\b|\bcan't breathe in yoga\b",
    # ordinary uses of words on the approved list
    r"\bcan't go on (?:a|an|the|my|this|that|any|another|these) (?:\w+ ){0,2}?(?:diet|holiday|vacation|trip|walk|run|date|ride|cruise|hike|hunt|fast|cleanse|plan|medication|meds|pill|treadmill|bike|rollercoaster|swing|bender|break|retreat|tour|flight|drive|binge|outing|adventure)s?\b|\bcan't go on (?:holidays?|vacation|trips?|walks?|runs?|rides?|dates?|keto|statins?|medication|metformin|ozempic|insulin|social media|facebook|camping|cruises?|diets?|with (?:my|the|this|plain|these|all this|so much) (?:\w+ )?(?:diet|plan|program|chicken|salads?|food|meals?|workouts?|keto|fasting))\b",
    r"\b(?:won't|don't|never|not going to|refuse to|didn't|haven't|not ready to|not) (?:just )?(?:give|gave|given|giving) up\b(?! living| on living)", rf"\b(?:give|gave|giving|given|gives) up {_NOT_LIFE}(?:on )?(?:my |the |this |that |eating |drinking |all |some |most |a |an |red |white )?[a-z-]{{3,}}",
    r"\bhopeless (?:at|with|cook|in the kitchen|romantic|when it comes)\b", r"\bnot hopeless\b", r"\b(?:how (?:do|can|to) (?:i |you |we )?(?:not|avoid|prevent|stop)|avoid(?:ing)?|without|prevent(?:ing)?|risk of) overdos\w+", r"\bcan't overdose\b",
    r"\b(?:(?:can|could) (?:you|someone|people|we|one|a person|i)|do people|does it|is it (?:possible|easy) to|possible to|is too much \w+)\b[^.?!]{0,30}\boverdos\w+(?: (?:on|with|from|of))?(?: too much| taking)? ?(?:vitamins?|minerals?|iron|zinc|calcium|magnesium|omega|fish oil|fib(?:er|re)|protein|water|collagen|probiotics?|turmeric|b ?12|vitamin [a-z]\d?)\b(?: [a-z0-9]{1,3}\b)?|\bis too much (?:vitamin [a-z]\d?|iron|zinc|calcium|magnesium|omega|fish oil|fib(?:er|re)|protein|water) an overdose\b",
    rf"\b(?:nearly |almost )?overdos(?:e|ed|ing) (?:on|of|with) (?!(?:too (?:much|many) |a (?:\w+ )?(?:bottle|pack|box) of |all (?:of )?)?(?:my |the |some |his |her |their |our )?(?:\w+ )?(?:{_DRUGS})\b)(?:too much )?[a-z]+(?![^.?!]*\b(?:pills?|tablets?|capsules?|on purpose|meds|medications?|drugs|insulin|opioids?)\b)",
    r"\b(?:not|never|doesn't|didn't|isn't|hasn't|wouldn't|won't) (?:ever |really )?(?:hit|hits|hitting|hurt|hurts|hurting|abus\w+|beat|beating|threaten\w*) me\b",
    # the phone, the app, the hour
    r"\bcan't do this anymore\b(?=[^.?!]*\b(?:app|crash\w*|log ?in|password|page|website|screen|button|wifi|update)\b)", r"\bdon't want to be here (?:at|for|on|until|that|so) (?:\w+ )?(?:\d|early|the|class|long)",
    r"\b(?:my |the )?(?:phone|battery|laptop|car|scale|app|wifi|fitbit|watch|plants?|houseplant|upload|photo|hair|legs?|arms?|starter|sourdough|yeast|signal|screen|lungs)(?: \w+){0,2} (?:died|is dead|are dead|feel dead|is dying|keeps? dying|were dying)\b",
    r"\bwon't be (?:here|around|in) (?:next (?:week|month|\w+day)|until (?!it)|till (?!it)|on (?:\w+day|the \w+)|for (?:the |a |my )?(?:class|meeting|dinner|lunch|call|session|weekend|holidays?|week|few days)|this (?:week|weekend|\w+day|morning|afternoon)|at (?:\d|noon|lunch)|before (?:noon|\d|lunch|dinner)|after (?:lunch|\d|noon))(?![^.?!]*\b(?:ending|sorry|goodbye|forever|no more)\b)",
    r"\bwon't be (?:here|around|in) (?:tomorrow|tonight|today) (?:because|since|as|so|but) (?:i'm|i|we're|we|my)\b(?=[^.?!]*\b(?:fly\w*|travel\w*|off|work\w*|away|vacation|holiday|appointment|visit\w*|camping|wedding|out of town|moving|surgery)\b)",
    # what ends is a fast, a plan, or a relationship
    r"\bend(?:ing|ed)? (?:it|things|this|that|all)\b(?=[^.?!]{0,40}\b(?:with (?:my |the |this )?(?:boyfriend|girlfriend|husband|wife|partner|ex|trainer|coach|him|her|them|gym|fast|diet|friend|boss)|fast|diet|membership|subscription|relationship|marriage|lease|trial|streak|plan|program|session|meeting|contract|call)\b)", r"\b(?:fast|diet|membership|subscription|relationship|marriage|lease|trial|streak|plan|program|session|meeting|contract)\b[^.?!]{0,40}\b(?:want to|wanna|should i|can i|how do i|going to|ready to|about to) end(?:ing)? it\b(?! all)",
    r"\b(?:think\w*|consider\w*)(?: of| about)? ending (?:my|the|our|this|a) (?:marriage|relationship|membership|subscription|lease|fast|trial|plan|program|contract|engagement|friendship|streak|diet)\b",
)
# A slip of the knife, a fall, a pan: what was hurt was not meant. Only for the
# verbs that can be an accident, only beside them, and never when it was meant.
_SLIP = re.compile(r"\b(?:hurt|hurting|hurts|cut|cutting|cuts|burn|burns|burned|burnt|burning|injur\w+|stabbed|poked|scald\w*|grazed|scratch\w*|bruised|bit|strain\w*|pull\w*|poison\w*|choke[ds]?|hit|bang\w*) (?:(?:my|him|her|them)sel\w+|(?:my|his|her|their) (?:\w+ )?(?:arms?|legs?|thighs?|fingers?|thumb|hand|foot|feet|knee|shin|skin|palm|face|tongue|lip|head|toe))\b")
_SLIPPED = re.compile(
    r"\b(?:accident\w*|by mistake|oops|clums\w+|cooking|cooked|baking|chop\w*|slic\w*|peel\w*|grat(?:e|ed|er|ing)|dic(?:ed|ing)|carv(?:e|ing) (?:the )?(?:turkey|pumpkin)|cutting (?:up )?(?:vegetables|veggies|onions?|carrots?|bread|a|the|an)|onions?|carrots?|bread|avocado|knife skills|oven|stove|frying|pan|grill(?:ing)?|bbq|kettle|iron(?:ing)?|curling|straightener|soup|coffee|tea|oil|boiling|steam|mandolin\w*|opening|can opener|can lid|tin|tuna|jar|broken|plate|"
    r"shav(?:e|ed|ing)|gym|work(?:ing)? ?out|workouts?|exercis\w*|training|squat\w*|bench press|lift(?:ed|ing)?|weights?|dumbbells?|kettlebells?|running|run|jog\w*|swim\w*|spin|pilates|yoga|barre|zumba|crossfit|handstand|burpees?|push-?ups?|pull-?ups?|planks?|lunges?|stretch\w*|treadmill|elliptical|row(?:er|ing)|bike|biking|cycl\w+|hik\w+|climbing|garden\w*|mowing|shovel\w*|football|soccer|tennis|pickleball|golf\w*|basketball|volleyball|softball|baseball|hockey|skat\w+|ski(?:ing)?|snowboard\w*|surf\w*|"
    r"danc\w+|playing|fell (?!apart|asleep)|falling (?!apart|asleep)|slipped|tripped|ladder|stairs|furniture|moving (?:house|boxes|a|the)|carrying|trampoline|practice|campfire|candle|sewing|hammer|drill|fence|rock|thorns?|bad (?:shrimp|fish|chicken|sushi|oysters)|food poisoning|doing (?:squats|yoga|burpees|too much)|padel|squash|badminton|netball|rugby|cricket|bowling|boxing|karate|judo|parkour|trail|tweaked|calf|hamstring|ankle|sprain\w*|muscle|floorboard|doorframe|door|corner|curb|stubbed|bumped|coffee table|kitten|cat)\b|~")
_MEANT = re.compile(r"\b(?:on purpose|purposely|deliberate\w*|intentional\w*|to (?:feel|cope|punish|bleed|calm|release|stop the|make (?:it|the pain)|get (?:it|the pain) out)|because i (?:hate|hated|deserve|feel|felt|couldn't|can't|was (?:so )?(?:sad|angry|upset|alone))|when i(?:'m| am| was| feel| felt)? (?:so |feeling )?(?:upset|angry|sad|alone|drunk|anxious|overwhelmed|stressed|down|depressed|lonely|low)|urges?|in secret|hide|hiding|razors?|blades?|wrists?|thighs?|crying|numb|suicid\w*|kill\w* (?:my|him|her|them)sel\w+|die|self-harm\w*)\b|(?<!don't )(?<!not )\bwant(?:ed|ing)? to (?:hurt|cut|burn|punish) myself\b")
_MEANT_HERE = re.compile(r"\b(?:on purpose|purposely|deliberate\w*|intentional\w*)\b")

# Saying it is not so.
_DENIALS = _rules(
    r"\b(?:i'm|i was|i've been|i've|i|'m|feel|feeling|been|am)?\s*(?:definitely |absolutely |really |honestly )?(?:not|never|no longer|wasn't|isn't|never been|never felt|haven't been|haven't felt|don't feel|didn't feel)(?: (?:feeling|been|being|at all|actually|really|currently|ever|even|anywhere near|depressed or|sad or))* suicidal\b",
    r"\b(?:no|without|don't have|never had|haven't had|not having|not had|denies|any|zero)(?: any| more| real| a| one| single)* (?:suicidal|self-harm|harmful) (?:thoughts?|ideation|feelings?|urges?|ideas?)\b",
    r"\b(?:no|never had|don't have|haven't had|without|not had)(?: any)? (?:thoughts?|plans?|urges?) (?:of|about|to) (?:suicide|self-harm|hurt(?:ing)? myself|harm(?:ing)? myself|kill(?:ing)? myself|dying|end(?:ing)? my life)\b", r"\b(?:have|had)(?: any)? (?:thoughts?|urges?|plans?) (?:of|about) (?:suicide|self-harm|dying)\b(?=[^.?!]{0,20}\b(?:and|but) i don't\b)", r"\b(?:never|don't|didn't|doesn't) (?:ever )?self-harm\w*",
    r"\b(?:not|never|don't|wasn't|isn't|haven't been|i'm not|no longer) (?:\w+ )?(?:think(?:ing)? (?:about|of)|consider(?:ing)?|contemplat(?:e|ing)|plan(?:ning)?) (?:suicide|self-harm|dying|killing myself|hurting myself|harming myself|ending my life|ending it all)\b",
    r"\b(?:don't|didn't|never|wouldn't|would never|won't|will never|i'd never|have never|'ve never|haven't|'m not going to|not going to|no plans? to|no intention (?:of|to)|no desire to|no wish to|not planning (?:to|on)|not trying to|no reason to|not about to|not here to)"
    r"(?: (?:ever|actually|really|even|have any plans? to|have (?:a|any) plan to|want(?:ed)? to|plan(?:ned)? to|try(?:ing)? to|tried to|think(?:ing)? (?:about|of)|thought (?:about|of)|intend to|be|go and))* (?:kill|hurt|harm|cut|killing|hurting|harming|cutting|hurted|harmed|killed) myself\b",
    r"\b(?<!don't )(?:don't|didn't|never|no longer|not) (?:\w+ )?(?:want(?:ed)? to|wanting to) (?:die|be dead|end (?:my life|it all))\b", r"\b(?:won't|wouldn't|would never|will never|never|not going to|don't want to|not planning to) (?:ever )?(?:end my life|take my (?:own )?life|end it all|commit suicide|overdose|self-harm)\b",
    r"\b(?:ask|asks|asked)\b[^.?!]{0,40}\bsuicidal\b[^.?!]{0,40}\b(?:answer is (?:always )?no|i say no|said no)\b",
    r"\bthinking (?:of|about) ending my (?:gym|contract|membership|subscription|lease|diet|fast|marriage|relationship|trial)", r"\b(?:ask|asks|asked)(?: me)? (?:if|whether) i\b[^.?!]{0,80}\b(?:say|said|answer(?:ed)?|told (?:her|him|them|the \w+)) no\b", r"\b(?:ask|asks|asked)(?: me)? (?:if|whether) i\b[^.?!]{0,80}[.?!] no\b", r"\b(?:ask|asks|asked)(?: me)? (?:if|whether) i\b[^.?!]{0,80}\b(?:and|but|well|no),? i'm not\b", r"\bno self-harm\b", r"\b(?:didn't|haven't|don't) (?:\w+ )?overdose\b(?! (?:enough|yet))", r"\bnot a danger to myself\b",
    r"\b(?:not|no longer|stopped|quit) (?:cutting|self-harming)(?: anymore)?\b(?! (?:out|back|down|carbs?|sugar|calories|weight|fat|salt|meat|dairy|gluten|bread|the|my|up|it|on|portions?|snacks?|soda|coffee|alcohol|processed|for|corners|any)\b)",
    r"\bno plans? (?:and |or |, )?no intent(?:ion)?\b",
)
# What stands before a "no" and makes it none: "the only reason I haven't",
# "I can't promise I won't", "not a day goes by that I don't", "I lied when I said".
_NO_NO = re.compile(
    r"\b(?:(?:can't|cannot|couldn't|won't) (?:say|promise|guarantee|swear|trust|be sure|stop|not)|no (?:guarantee|promise|telling)|don't (?:know|trust|think i|want to say|believe)|not (?:sure|certain|convinced|promising)|not going to say|lied|lying|lie|pretend\w*|fak(?:e|ing)|only (?:reason|thing)|reason (?:that |why )?i|why (?:i|haven't i)|amazed|surprised|shocked|miracle|wonder|"
    r"a day|day (?:goes|that|where|when)|days? i|never (?:really )?stop\w*|don't stop|didn't stop|haven't (?:really )?stop\w*|hard not to|trying not to|struggling not to|if i had|unless|until|whether|should i|doubt|said (?=i'm)(?=.*\bbecause i))\b(?:(?!\b(?:but|because)\b)[^.?!;]){0,40}$")
# What stands after it and makes it none: "yet", "until Christmas", "more than today".
_NO_LONGER = re.compile(r"^\W*(?:yet|until|till|before (?:i|my|the)|unless|right now but|just yet|today\b[^.?!]*\b(?:tomorrow|maybe)|tonight\b[^.?!]*\b(?:maybe|tomorrow)|more than|so (?:badly|much|bad)|as (?:much|badly|bad|strongly)|this (?:much|badly|bad|strongly)|enough|if i had|if (?:he|she|they|you) (?:stay|come|call)|only because|just because|because i(?:'m| am| was) (?:scared|afraid|ashamed|embarrassed|worried)|so (?:that )?(?:they|he|she|my \w+|nobody|no one) (?:don't|won't|wouldn't|doesn't|will|would)|because of my (?:kids|son|daughter|dog|cat|mom|mum|family))\b")
# And then says it is: "I told her I'm not suicidal. I am."
_IS_SO = re.compile(r"[.!?;,]\s*(?:but |though |although |and |well |actually |honestly )*(?:(?:i am|i'm)(?: though| now)?(?=\W*(?:$|[.!?,]))|(?:i am|i'm) (?:though|suicidal|lying)|i do(?: though| now)?|i was lying|(?:that|it)(?:'s| was| is) (?:a lie|not true|all lies)|i lied|not true|now i (?:do|am|'m)|truth is i(?: am|'m| do))")
# About something else, however it is said. Never a "no" to the question.
_NOT_THAT = _rules(
    r"\bchest pains?\W+(?:none|no\b|nope|nothing|never)",     r"\b(?:isn't|not|aren't|never) the same (?:thing )?as (?:wanting to die|being suicidal|suicide|wanting to hurt myself)\b", r"\bwhen i (?:said|wrote|typed)(?: that)?[^.?!]{0,60}\bi meant\b",
    r"\b(?:no|not|without|don't have|didn't have|haven't had|never had|no more|not having|don't get|denies|any)(?: any| more| real| a| much)? (?:chest pains?|chest tightness|pain in my chest|(?:trouble|difficulty|problems?) breathing|shortness of breath|numbness|slurred speech|heavy bleeding|swelling|heart attacks?|strokes?|seizures?)\b", r"\bnot (?:having|having any|had) (?:chest pains?|trouble breathing|a (?:heart attack|stroke|seizure))\b",
    r"\b(?:don't|never|didn't) (?:have|had) an eating disorder\b",
    r"\b(?:avoid|prevent|without|risk of|not|worried about|afraid of|scared of|keep from) (?:over)?(?:injuring|straining|pulling|poisoning|scalding) myself\b", r"\bto not injure myself\b|\bnot to injure myself\b",
    r"\b(?:avoid|prevent|without) (?:hurting|cutting|burning) myself\b(?=[^.?!]*\b(?:while|when i(?:'m)? (?:run|lift|cook|chop|slice|train|exercise|garden|shave)\w*|running|lifting|cooking|chopping|slicing|peeling|exercis\w+|training|workouts?|gym|yoga|squats?|~|knife skills|oven|stove|grill|stretching)\b)",
)
# A "no" that is taken back is not a no. Read from where the "no" ended, and only
# when what follows is about it: "but I want to lose weight" takes nothing back.
_TAKEN_BACK = re.compile(
    r"^(?:.{0,30}?\W|\W*)i (?:just |only |do |still )+(?:think|keep thinking|can't stop thinking|fantasi\w+|dream) (?:about|of) (?:it|dying|death|doing it|that)\b|^.{0,30}?\b(?:but|though|although|except)\b[^.?!]{0,40}?(?:"
    r"\b(?:i (?:do|might|may|will|would|could|am|want to|have to|need to|feel like it|can't help it|can't stop)|i think i (?:am|will|might|would|could|want to)|i(?:'m| am) (?:going to|about to|tempted|close|lying|breaking (?:it|that))|think i'm going to|"
    r"sometimes|sometimes i do|part of me (?:does|wants to)|not so sure|tempted|i lied|lying|not true)\W*(?:$|[.!?,])"
    r"|\b(?:can't (?:stop|help) (?:thinking|wanting|doing|feeling)|keep (?:thinking|wanting|doing|hurting|cutting|feeling)|think(?:ing)? (?:about|of) (?:it|doing it|dying|death|suicide|killing|ending)|thought about (?:it|dying|death)|"
    r"wants? to (?:die|disappear|be dead|do it|stop existing|not exist|end it|hurt myself|cut|vanish)|feel like (?:dying|doing it|i want to die|it)|what if i (?:do|did|die|can't)|(?:scared|afraid) (?:that )?i(?:'ll| will| might)|going to do it|might do it|close to (?:doing )?it|i lied|was lying|the thoughts|breaking that promise|can't keep (?:that|the|my) promise)\b)")
_NOT_A_NO = _rules(
    r"\bdon't not want to (?:die|live|be here)\b", r"\bnot that i don't want to die\b", r"\bnever said i (?:wasn't|'m not|weren't) suicidal\b", r"\bnot (?:only|just) suicidal\b", r"\bnot only am i suicidal\b", r"\bnot suicidal yet\b",
    r"\b(?:say|said|swore|thought) i'd never (?:do it|do that)\b.{0,50}\bnot (?:so |as |too )?sure\b",
)

_STORY = r"(?:song|lyrics?|movie|film|book|novel|show|series|episode|play|podcast|documentary|article|game|poem|character|band|album|headline|news|story|tv|soap|opera|magazine|title)"
_QUOTED = re.compile(r"[\"“”]([^\"“”]{2,160})[\"“”]|(?<![a-z])'([^']{6,160})'(?![a-z])")
_STORY_TALK = re.compile(rf"\b{_STORY}s?\b(?:(?!\b(?:and|but|so|because|then|i|i'm|i've|me|my)\b)[^.?!,;]){{0,70}}\b(?:suicid\w*|self-harm\w*|overdos\w+|kills? (?:him|her|them)sel\w+|killing (?:him|her|them)sel\w+|killed (?:him|her|them)sel\w+|wants? to die|dies|died)\b")
# Right beside a quotation, with nobody speaking in between: a title or a lyric.
_SANG_BEFORE = re.compile(r"\b(?:songs?|lyrics?|movies?|films?|books?|novels?|episode|poem|album|headline|title|track|(?<!crisis )(?<!help )(?<!hot )lines?|chorus|show|series|band|called|titled|named|sings?|sang|singing|sung|quot(?:e|ed|ing))\W+(?:(?:called|titled|named|that|which|is|was|it's|goes|says?|said|sings?|sang|singing|line|lyrics?|with|the|a|where|he|she|they|it|like|about|when|on|in|from|of|by|and|then|just)\W+){0,5}$")
_SANG_AFTER = re.compile(r"^\W*(?:by (?!tonight|now|tomorrow|then|myself|the)[\w']+|(?:is|was) (?:a|my|the|such a) (?:\w+ )?(?:song|movie|film|book|line|lyric|tune|track|title|poem)|(?:was playing|at karaoke|came on)|on (?:the radio|repeat|spotify)|from (?:the|a|that) (?:\w+ )?(?:song|movie|film|book|show|album|play))\b")
_JOINED = r"\b(?:and|but|so|because|then|which|while|though|although)\b"
_ME = r"\b(?:i|i'm|i've|i'll|i'd|me|my|myself)\b"
# A title is a title whatever it says; what something is ABOUT ends where they do.
_TITLED = re.compile(rf"\b{_STORY}s?,? (?:(?:is|was|are) )?(?:called|titled|named) (?:(?:i|i'm) (?:(?!{_JOINED})[\w']+ ?){{1,5}}|(?:(?!{_JOINED}|{_ME})[\w']+ ?){{1,6}})")
_LYRIC = re.compile(rf"\b(?:songs?|lyrics?|chorus|track|poem|tune),? (?:that )?(?:says?|said|goes|went|sings?) (?:that |like )?(?:i|i'm)\b(?: (?!{_JOINED})[\w']+){{1,6}}")
_CONCERNS = re.compile(rf"(?<!my )\b{_STORY}s?,? (?:(?:is|was|are) )?about\b(?:(?!{_JOINED}|{_ME})[^.?!;,])*")
_FIRST_RISK = re.compile(r"\b(?:myself|my life|me|i want|i'm|i feel|i wish|i can't|i don't|i hate|i need|i've been|i'll)\b")
_RELATES = re.compile(r"\b(?:how i feel|me too|same here|so do i|like me|i relate|is me|about me|i feel like that|feel the same|want to do it|going to do it|i(?:'m| am) ready|i get it|it's me|i understand (?:why|it)|i want to (?:as well|too))\b")
_MEANT_IT = re.compile(r"\bi? ?meant it\b|\bi mean it\b|\band i do\b")
_OTHERS_SAID = re.compile(r"\b(?:he|she|they|my (?!self)\w+|friend|someone|somebody)(?: \w+){0,3} (?:said|says|told me|texted(?: me)?|wrote|messaged(?: me)?|posted|keeps saying|was saying|is saying)\W{0,4}$")


@dataclass(frozen=True)
class _Aside:
    """Where a message is plainly something else. Nothing is cut out before the
    worrying rules run: what a rule found is set aside only when it ends inside
    one of these, so a film in one half of a sentence cannot take the other half
    with it."""
    spans: tuple[tuple[int, int], ...]
    others: tuple[tuple[int, int], ...]     # another person's own words, quoted
    taken_back: bool
    kept: str                               # the message without those stretches

    def covers(self, found: re.Match) -> bool:
        return any(a <= found.end() - 1 < b for a, b in self.spans)

    def somebody_elses(self, found: re.Match) -> bool:
        return any(a <= found.start() < b for a, b in self.others)


def _unnamed(text: str) -> str:
    return " ".join(_NAMES.sub(" ~ ", _TITLES.sub(" movie ~ ", text)).split())


def _sentence(text: str, start: int, end: int) -> tuple[int, int]:
    first = max((text.rfind(mark, 0, start) for mark in ".?!;"), default=-1) + 1
    return first, min((at for at in (text.find(mark, end) for mark in ".?!;") if at >= 0), default=len(text))


def _denials(text: str) -> tuple[list[tuple[int, int]], bool]:
    """Where somebody says it is not so, and whether they take it back. What
    only looks like a "no" is neither: the words are read as they stand."""
    if _first(_NOT_A_NO, text) is not None:
        return [], True
    spans, taken_back = [], False
    for pattern in _DENIALS:
        for m in pattern.finditer(text):
            before, after = text[_sentence(text, m.start(), m.end())[0]:m.start()], text[m.end():m.end() + 160]
            if re.search(r"\bstop", m.group(0)) and re.search(r"\b(?:never|don't|haven't|hasn't|not|didn't|can't)\b(?: \w+){0,2} ?$", before + m.group(0)[:m.group(0).index("stop")]):
                continue
            if _NO_NO.search(before) or re.search(r"\b(?:can't|couldn't|hard)\W*$", before) or _NO_LONGER.search(after):
                continue
            if _IS_SO.search(after):
                taken_back = True
                continue
            taken_back = taken_back or bool(_TAKEN_BACK.search(after))
            spans.append(m.span())
    return spans, taken_back


def _slips(text: str) -> list[tuple[int, int]]:
    """A knife, a fall, a pan: what was hurt was not meant."""
    spans = []
    for m in _SLIP.finditer(text):
        first, last = _sentence(text, m.start(), m.end())
        if _MEANT.search(text[first:last]):
            continue
        joins = r"\b(?:and|but|so|because|then)\b"
        left = max([first, *(first + j.end() for j in re.finditer(joins, text[first:m.start()]))])
        right = min([last, *(m.end() + j.start() for j in re.finditer(joins, text[m.end():last]))])
        if _SLIPPED.search(re.sub(r"\bafter (?:my |the |a )?\w+(?: \w+)?", " ", text[left:right])):
            spans.append(m.span())
    return spans


def _aside(text: str) -> _Aside:
    spans: list[tuple[int, int]] = _slips(text)
    others: list[tuple[int, int]] = []
    for quote in _QUOTED.finditer(text):
        before, after = text[max(0, quote.start() - 60):quote.start()], text[quote.end():quote.end() + 40]
        if _MEANT_IT.search(text):
            continue
        if _OTHERS_SAID.search(before):
            others.append(quote.span())
        elif _SANG_BEFORE.search(before) or _SANG_AFTER.match(after):
            spans.append(quote.span())
    if not _RELATES.search(text):
        spans += [m.span() for pattern in (_TITLED, _LYRIC, _CONCERNS) for m in pattern.finditer(text)]
        if not _FIRST_RISK.search(text):
            spans += [m.span() for m in _STORY_TALK.finditer(text)]
    spans += [m.span() for pattern in (*_SAYINGS, *_NOT_THAT) for m in pattern.finditer(text)]
    denials, taken_back = _denials(text)
    spans += denials
    kept, at = [], 0
    for a, b in sorted(spans):
        if a >= at:
            kept += [text[at:a], " ~ "]
        at = max(at, b)
    kept.append(text[at:])
    return _Aside(tuple(spans), tuple(others), taken_back, " ".join("".join(kept).split()))


# ---- how worried to be ------------------------------------------------------------------

_MYSELF_VERBS = (r"(?:kill|killing|killed|hurt|hurting|harm|harming|harmed|cut|cutting|hang|hanging|hung|shoot|shooting|shot|stab|stabbing|stabbed|burn|burning|burned|burnt|"
                 r"drown|drowning|poison|poisoning|poisoned|suffocate|suffocating|strangle|strangling|injure|injuring|off|offing|unalive|unaliving|end|ending|punish|punishing)")
_MYSELF = rf"(?<!weight )(?<!pounds )(?<!it )(?<!that )(?<!them )\b{_MYSELF_VERBS} (?:my own self|myself)\b"
_DIE = r"(?:die|be dead|not be alive|stop living|stop existing|not exist|not wake up|never wake up|cease to exist|be with (?:him|her|them) again in heaven)"
_PILLS = (r"(?:pills?|tablets?|capsules?|meds|medications?|medicines?|insulin|metformin|paracetamol|acetaminophen|tylenol|ibuprofen|advil|aspirin|antidepressants?|"
          r"sleeping (?:pills?|tablets?)|painkillers?|opioids?|xanax|valium|statins?|warfarin|blood thinners?|beta blockers?|(?:iron|vitamin|magnesium|potassium) (?:pills?|tablets?|capsules?|supplements?)|supplements?)")
_LIVE_ON = r"(?:live|living|go on|going on|be alive|being alive|keep going|keep living|keep on living|carry on|be here|stay alive|stay here)"
_NOT_HERE = r"(?:i (?:wasn't|weren't|was not|am not) (?:here|around|alive|in it)|i (?:was|were) (?:gone|dead|not here)|i (?:disappeared|died)|without me)"
_THEY = r"(?:everyone|everybody|they|people|you|the world|my (?:family|kids|children|wife|husband|parents|mom|mum|dad|friends|partner|boyfriend|girlfriend)|it|life|things)"

_SELF_HARM = _rules(
    _MYSELF,
    r"\b(?:end|ending|ended|take|taking|took|taken) my (?:own )?life\b", r"\b(?:do|doing|make|making|did) away with myself\b|\bput(?:ting)? an end to (?:myself|my life)\b|\bfinish(?:ing)? (?:myself(?: off)?|things myself|the job myself)\b|\b(?:my|this) life to (?:stop|end|be over)\b|\bwant(?:ed|ing)? out of (?:this )?life\b|\bwant out\b(?=.{0,60}\bout of (?:life|everything|this life)\b)|\bfinish my life\b|\b(?:pictur|imagin|see|seeing)(?:e|es|ing)? myself (?:dead|hanging|in a coffin|gone)\b|\bno (?:wish|will|desire) to (?:go on |keep |carry on )?(?:live|living|be alive)\b",
    rf"\b(?:want(?:ed|ing|s)?|need|ready|deserve|long(?:ing)?)(?: (?:just|really|so badly|to just))* to (?:just |really )?{_DIE}\b",
    rf"\b(?:part|most|all|some) of me (?:just |really )?wants? to {_DIE}\b", r"\b(?:wish|wished|wishing) (?:that )?i (?:was|were) (?:dead|gone|not alive|no longer alive|never born|not here)\b",
    r"\b(?:rather be dead|better off dead|wish (?:that )?i (?:wasn't|weren't) (?:alive|here|born)|wish i'?d never been born|wish i had never been born|wish i (?:could|would) (?:just )?die|wish i would(?:n't| not) wake up)\b",
    r"\bdon't (?:really )?feel like (?:living|being alive|existing|being here)\b", r"\b(?:think|thinking|thought|thoughts) (?:about|of) (?:killing|hurting|ending) yourself\b", r"\bdeath (?:sounds?|seems?|feels?|looks?)(?: \w+){0,2} (?:nice|good|peaceful|easier|better|like a relief)\b", r"\b(?:everything|all the pills|anything) in (?:my|the) medicine cabinet\b(?<!threw out everything in my medicine cabinet)(?<!organized everything in my medicine cabinet)(?<!cleaned out everything in my medicine cabinet)(?<!sorted everything in my medicine cabinet)(?<!check everything in my medicine cabinet)", r"\bdon't deserve to (?:live|be alive|be here|exist)\b", r"\bhurry up and take me\b|\b(?:wish|hope|want|pray)\b[^.?!]{0,30}\b(?:god|lord|jesus|heaven|angels?|death|reaper|universe|cancer|it|something|someone|the earth) (?:would|to|will|could) (?:just )?take me\b(?! to\b| out\b| home (?:from|after)| on| dancing| less)",
    r"\b(?:scratch|punch|burn|bit|bite|hit|bang|pinch|slap)(?:ed|ing|es|s|t)? (?:at |into )?(?:myself|my (?:own )?(?:arms?|legs?|thighs?|wrists?|stomach|skin|face|head))\b(?=[^.?!]*\b(?:bleed\w*|bruis\w*|until|till|on purpose|when i(?:'m| am)? (?:feel|binge|eat|mess|fail|upset|angry|sad|stressed|alone|overwhelmed)|after i eat|goes quiet)\b)", r"\bwant (?:it|this|everything) (?:all )?(?:over|finished)\b(?! (?:by|before|with|on|soon so|so i can|for)\b)", r"\brelief (?:not to|to not|if i didn't) wake up\b(?! (?:hungry|at|tired|sore|early|with|to|every|in|feeling|bloated)\b)",
    r"\b(?:top|topping|neck|necking) myself\b|\bdo(?:ing)? myself in\b", r"\b(?:hop(?:e|ing)|wish(?:ing)?)\b[^.?!]{0,40}\b(?:heart (?:just )?(?:gives out|stops)|i don't (?:make it(?! (?:too|to|for|worse|salty|spicy|burn|a|into)\b)|survive)|it kills me)\b", r"\b(?:does|will|would) it hurt (?:much )?(?:when|if|to) (?:you |i |someone )?(?:od|overdose|die|hang|drown)\b",
    rf"\bnot sure (?:if |that |whether )?i (?:still )?want to {_LIVE_ON}\b(?! (?:with|a|an|the (?:diet|plan|program|cruise|trip)|to|on|for|in|at|my (?:diet|plan)|keto|this (?:diet|plan|program)|vacation|medication)\b)", r"\bfeel(?:ing)? like (?:killing myself|ending (?:it|my life)|hurting myself|cutting(?=\W*(?:$|[.!?,]|again|myself|and\b|because))|i want to die)\b",
    r"\bdon't (?:\w+ )?want to (?:live\b(?! (?:in|at|with|near|next|alone|on|under|without|off|like (?:a|an|the)|through|by|here|there|too|as|a life|my (?:whole |entire )?life (?!anymore|any ?longer|like this)\w+)\b)|be alive|exist\b(?! on)|go on living|keep living|carry on living|be here anymore\b(?![^.?!]*\b(?:hotel|party|office|job|class|app|meeting|gym|conference|town|city|apartment|house)\b)|be on this (?:earth|planet)|wake up\b(?! (?:early|at|so|before|tired|to|late|for|feeling|every|hungry|my|the|him|her|with|in|and (?:eat|go|work)|sore|bloated|sick|stiff|craving)\b))",
    rf"\b(?:no|any|one|a|single)(?: single| good)? (?:reason|point)(?: left)?(?: for me)? (?:to|in) {_LIVE_ON}\b(?! (?:with (?:the |this |my )?(?:plan|diet|program|keto|app|fasting)|on (?:a |the |this |my )?(?:plan|diet|program|statins?|medication|keto|cruise)|a (?:diet|cruise|trip)|the (?:diet|plan|program)|this (?:diet|plan|program)|keto|paleo|statins?|medication|vacation|diets?)\b)", r"\bnothing (?:left )?(?:to live for|worth living for)\b", r"\b(?:life|it) (?:isn't|not|is no longer|'s not) worth (?:living|going on)\b",
    rf"\bbetter off without me\b|\b{_THEY}(?:'d|'ll| would| will)? (?:all )?be (?:so much |much |a lot )?(?:happier|better|better off|lighter|easier|relieved) (?:if )?{_NOT_HERE}", r"\b(?:nobody|no one|no-one) would (?:miss me(?! (?:at|if i (?:skip|leave|don't go|miss)|for|on)\b)|notice if i(?:'m| was| were| am)? (?:gone|dead|died|missing|not here|disappeared|vanished|left|stopped (?:existing|being)|never)|care if i (?:die|died|was|were|disappear|disappeared))\b",
    r"\b(?:hope|pray|praying|hoping|wish)(?: that)? i (?:don't|never|won't|didn't|wouldn't) wake up\b(?! (?:hungry|sore|bloated|late|tired|stiff|sick|in (?:pain|the middle)|with|at|early|too|before|feeling|puffy|craving|every|so)\b)", r"\b(?:hope|wish|hoping) i (?:die|died|could die)\b", r"\bdon't (?:even |really )?care if i (?:die|live|wake up)\b(?! (?:late|early|at|tired|hungry|sore)\b)", r"\bwouldn't (?:mind|care) (?:dying|if i died|not waking up|if i didn't wake up)\b",
    r"\b(?:wouldn't mind|wish|hope|hoping|want|if)(?: if)?(?: a| the| some)? (?:bus|car|truck|train|lorry)(?: \w+){0,2} (?:hit|hits|ran over|run over|runs over) me\b",
    r"\b(?:tired|sick|done|finished) (?:of|with) (?:living|being alive|existing)\b(?! (?:with|in|on|like|at|near|paycheck|off|out)\b)", r"\b(?:done|finished) with life\b", r"\btired of life\b", r"\b(?:easy|only|quick) way out\b(?=[^.?!]*\b(?:life|dead|die|of this|for me|it all|end)\b)(?![^.?!]*\b(?:ozempic|takeout|diet|weight|pounds|surgery|gym)\b)",
    r"\bend(?:ing)? it all\b", r"\bend(?:ing)? it (?:tonight|now|today|for good|once and for all|this way|soon|tomorrow)\b(?![^.?!]*\b(?:with him|with her|membership|subscription|plan|diet|fast|relationship)\b)", r"\bwant to end it\b(?! with)",
    r"\bjump(?:ing|ed)? (?:off|from|out of) (?:a |the |my |that |this )?(?:\w+ )?(?:bridge|roof(?:top)?|building|cliff|balcony|window|ledge|overpass|tower|high place|parking (?:garage|structure))\b(?! (?:into (?:the )?(?:water|pool|lake|sea|ocean)|for (?:a|an|some))\b)|\bjump(?:ing)? off (?:something|it)(?: high)?\b", r"\b(?:jump|jumping|step|stepping|walk|walking|throw myself|run|running) in front of (?:a |the |an oncoming |oncoming )?(?:train|car|bus|truck|lorry|traffic)\b", r"\b(?:walk|walking|run|running|step|stepping) into (?:oncoming )?traffic\b|\b(?:drive|driving|swerv\w+) (?:my car )?into (?:oncoming traffic|a (?:tree|wall|pole|truck|lake|river|ditch))\b", r"\bdriv(?:e|ing) (?:my car )?(?:off (?:a|the) (?:bridge|cliff|road)|into (?:a|the) (?:tree|wall|river))\b(?! at the end)", r"\blet(?:ting)? go of the wheel\b",
    r"\b(?:roof|bridge|balcony|ledge|tracks|cliff|open window)\b[^.?!]{0,40}\b(?:wonder\w*(?! (?:if (?:my|i should eat)|what to)\b)|imagin\w*|think(?:ing)? about (?:jumping|it)|feel anything|what it would (?:feel|be) like)\b(?![^.?!]*\b(?:form|reps|glute|dinner|lunch|shorten)\b)", r"\b(?:look(?:ing)? at|star(?:e|ing) at|think(?:ing)? about)(?: my| the)? (?:pills|blade|razor|knife|rope|gun)\b(?=[^.?!]*\b(?:i|me|again|tonight|myself|use)\b)",
    r"\b(?:slit|slitting|cut|cutting) my (?:wrists?|throat|veins?)\b", r"\b(?:cut|cuts|cutting|slashed|sliced) (?:up )?my (?:arms?|thighs?|legs?|skin)\b(?! (?:on the|while|shaving|workout|day)\b)", r"\b(?:bullet|gun) (?:in|to) my head\b", r"\bblow my brains\b",
    r"\bi cut again\b", r"\brelapsed (?:on|with|into) (?:self-harm|cutting)\b",
    r"\b(?:urges?|impulses?|want(?:ing)?|tempted|need) to (?:self-harm|overdose|bleed)\b", r"\b(?:thoughts?|thinking|dreaming|fantasi\w+) (?:of|about) (?:hurting|killing|harming|ending|dying|not being (?:here|alive)|overdosing|self-harm|suicide)\b",
    r"\b(?:want(?:ing)? to|going to|thinking (?:of|about)|might|could just|tempted to|planning (?:to|on)|feel like) (?:overdos\w+|od on|take(?:ing)? (?:them all|all (?:of )?(?:my|the) (?:pills|meds|medications?|medicine|tablets|insulin|sleeping pills|painkillers|antidepressants)(?! (?:with|in the|at (?:once|night|the same)|every|as|before|after|on time|together|or|from now)\b)))\b",
    r"\b(?:going to|want to|might|should|could|just|will|ready to|about to|rather) kms\b", r"\bunaliv\w+\b", r"\b(?:forever|eternal|endless) sleep\b|\bthe long sleep\b|\bsleep forever\b(?=[^.?!]*\b(?:want|just|wish|could)\b)",
    r"\b(?:pray|prays|praying|hope|hoping|wish|beg|begging|ask)\b[^.?!]{0,40}\btakes? me (?:in my sleep|away(?! (?:for|to|on)\b)|home to (?:him|jesus|god|heaven|be with))\b|\b(?:god|lord|jesus|death|angels?) (?:please |just |to |will |would )*takes? me (?:soon|tonight|home|now)\b", r"\b(?:i'd|would|could|might) have (?:ended (?:it|things|my life)|done it(?! already if)|killed myself)(?: all)? (?:by now|already|long ago|years ago|if)\b(?![^.?!]*\b(?:gym|app|store|steps|workout|open)\b)",
    r"\b(?:nobody|no one|no-one)(?: would| will|'ll|'d| is going to) (?:even |ever |really )*(?:miss me(?! (?:at|if i (?:skip|leave|don't go|miss)|for|on)\b)|notice (?:if )?i(?:'m| was| were| am)? (?:gone|dead|missing|not here)|care if i (?:die|died|was gone|disappeared))\b", r"\bwouldn't (?:mind|care) if i (?:\w+ ){0,6}(?:didn't|never|don't|wouldn't) (?:wake up|make it)\b",
    r"\bbetter off with (?:the|my) (?:life )?insurance\b", r"\bworth more (?:to (?:them|him|her|you) )?dead\b", r"\bvoices?\b[^.?!]{0,30}\b(?:end your life|kill yourself|hurt yourself|end it)\b", r"\btake it out on my (?:own )?body\b", r"\b(?:done|finished) (?:with )?being (?:here|alive)\b",
    r"\bkms\b[^.?!]{0,20}\bkind\b|\breal kms\b", r"\bbe (?:just |so much |much )?(?:fine|ok|okay|better|happier|relieved|free|lighter) (?:once|when|after|as soon as) i(?:'m|'ve) gone\b(?! (?:to|for|on|away|shopping|until)\b)", r"\b(?:no|lost (?:the|my|all)|don't have (?:the|any)|haven't (?:got )?(?:the|any)) (?:will|energy|strength|desire)(?: left)? to (?:live|stay alive|keep living|be alive)\b",
    r"\b(?:drove|walked(?! (?:by|along|past)\b)|went|stood|sat|parked|been) (?:\w+ ){0,3}?(?:to|on|at|by|near) the (?:bridge|train tracks|tracks|roof|cliff|railway)\b(?=[^.?!]*\b(?:sat|stood|hours?|looked|thinking|nearly|almost|couldn't)\b)(?![^.?!]*\b(?:miles?|steps|sunset|view|picnic|photos?|run|jog\w*|exercise|and back|calories|beautiful)\b)", r"\bwrote (?:a|my|the) note\b(?! (?:in (?:my|the) (?:food )?(?:diary|app|log|journal)|to (?:my (?:doctor|coach|trainer|dietitian)|self)|about)\b)(?=[^.?!]*\b(?:tore|ripped|burn\w*|threw|hid|deleted)\b)", r"\b(?:had|got|took|get|getting) (?:the|my|a) (?:blade|razor|knife) out\b(?=[^.?!]*\b(?:again|last night|tonight|looked|couldn't|arms?|myself)\b)",
    r"\b(?:wish|hope|wishing|hoping) (?:someone|somebody|something|god) (?:would|will|could) (?:just )?(?:end (?:it|me)|kill me|finish me)\b", r"\b(?:fantasi[sz]\w*|dream\w*|think\w*|imagin\w*) (?:of|about) (?:not existing|no longer existing|never waking up|not waking up|being dead|being gone(?! (?:for|from|on|until|to)\b))\b", r"\b(?:don't know if|not sure(?: if)?|don't think|doubt) i(?:'ll| will| can) (?:(?:make it|get|last|survive)(?: through)? (?:the night|(?:un)?till? morning)|(?:make it|get|last) through (?:tonight|today)|survive (?:tonight|today))\b",
    r"\bold way of coping\b(?=.*\b(?:arms?|legs?|blade|cut|marks|scars|blood)\b)", r"\b(?:marks|scars|cuts|burns)\b.*\bi did (?:them|that to myself)\b", r"\b(?:did|doing|done) it again\b(?=.*\b(?:sleeves|blade|cuts|marks|scars)\b)", r"\bcount(?:ed|ing)?\b[^.?!]{0,30}\b(?:pills|tablets|capsules)\b[^.?!]{0,40}\b(?:could do|enough|would do)\b(?![^.?!]*\b(?:trip|week|month|refill|vacation|until|travel)\b)",
    r"\bcommit(?:ting|ted)? suicide\b", r"\battempt(?:ed|ing)? suicide\b", r"\bsuicide attempt\b", r"\b(?:is it|does it|would it|will it) (?:painful|hurt|hurts?)(?: a lot)?(?: \w+){0,2} to die\b|\b(?:painful|hurt) to die\b|\bwhat (?:does|would) dying feel like\b",
)
# Where it ends, or goes on about themselves: what follows "cutting", "end it", "I can't go on".
_THEN_ENDS = r"(?=\W*(?:$|[.!?,;]|(?:and|but|because|so|when|until|after|again|anymore|any ?longer|tonight|today|now|lately|last|this|every|since|if|as|soon|yesterday|too|all|just|for (?:good|months|weeks|years|a while)|at night|in (?:the|my) (?:bathroom|shower|room|bed)|to (?:feel|cope|get|make|deal|calm|stop)|is|was|helps?|makes?|already|by now|long ago|years? ago|right|i|i'm|it's|please|honestly|really|so badly)\b))"
_WISH = r"(?:want(?:ed|ing|s)?|need|ready|deserve|long(?:ing)?|hop(?:e|ing)|pray(?:ing)?|(?:i'd|would|i would) (?:like|love|prefer|rather)|prefer|begging|dying|plan(?:ning)?|decided)"
_SELF_HARM += _rules(
    rf"\b{_WISH}(?: (?:just|really|so badly|still|only|honestly))* (?:to )?(?:just |really )?(?:die|be dead|not be alive|be gone forever|stop existing|not exist|never wake up|cease to exist|stop being alive)\b(?! (?:of|from|laughing|happy|hard|for (?!real|good|years|weeks|months|a while|so long|no reason))\b)",
    r"\bi should(?: just| probably| really)? (?:die|be dead|not be (?:here|alive)|kill myself|end it(?: all)?)\b(?! (?:if|of|from|laughing)\b)", r"\bi deserve (?:to be dead|death)\b", r"\b(?:dying|death) (?:is|would be|sounds like|feels like) (?:what i want|the only|all i (?:want|think)|my only|a relief|better|easier|the answer|welcome)\b", r"\b(?:to be|being) dead (?:would|sounds|seems|has to|must) (?:be )?\w+", r"\bi want (?:death|to be with death)\b",
    r"\bi wish(?:ed)?(?: that)? i (?:didn't exist|don't exist|never existed|was never|hadn't been born|weren't alive|wasn't alive|had died|had not been|could (?:just )?(?:die|not exist|stop existing|fall asleep and (?:never|not) wake|go to sleep and (?:never|not) wake|disappear forever))\b|\bi wish(?: that)? i'd (?:died|never been born|not (?:survived|woken up|made it)|been the one)\b", r"\bshould(?:'ve| have) been me\b(?=[^.?!]*\b(?:died|dead|killed|instead|not (?:him|her|them))\b)|\bi should(?:'ve| have) (?:died|killed myself|ended (?:it|things)|just died)\b|\bshould(?:'ve| have) killed myself\b",
    r"\b(?:hope|wish|pray|hoping|wishing)\b[^.?!]{0,30}\b(?:get|got|gets|getting) (?:hit|run over|struck|killed) (?:by|in) (?:a |the |an )?(?:bus|car|truck|train|lorry|accident|crash)\b", r"\b(?:bus|car|truck|train|lorry) would (?:just |please )?(?:hit|run (?:me )?over|take)(?: me)?\b", r"\bhop(?:e|ing) (?:that )?(?:the |this |my )?(?:cancer|it|disease|illness|virus|covid|god|lord|death|heart|tumou?r|flu|surgery) (?:kills|takes|finishes) me\b|\bhop(?:e|ing)\b[^.?!]{0,40}\b(?:and|to|i) die\b", r"\b(?:drink(?:ing)?|starv(?:e|ing)|smok(?:e|ing)|eat(?:ing)?) myself to death\b|\bhop(?:e|ing)\b[^.?!]{0,30}\bto death\b", r"\b(?:so|until|till) (?:that )?i(?:'ll| can| will| just)? die\b(?! (?:of|from|happy)\b)",
    r"\b(?:don't|doesn't|can't|won't) make me want to (?:stay alive|live|be here|go on)\b|\b(?:disappointed|sorry|angry|upset|sad) (?:that )?(?:i'm|to be|i woke up) (?:still )?(?:alive|breathing|here)(?=\W*(?:$|[.!?,]))|\bstill (?:alive|breathing) (?:and i (?:hate|wish)|every)", r"\bhop(?:e|ing) i (?:won't|don't) (?:last|make it|live|survive|be here)(?: much| very)? ?(?:long(?:er)?)?(?=\W*(?:$|[.!?,])|\W+(?:without|through|long|the|this))", r"\b(?:little |small )?(?:cuts|burns|scratches) on (?:myself|my own (?:skin|arms?|legs?|body))\b|\bscratch(?:ed|ing)? my (?:arms?|legs?|skin|face|thighs?) (?:bloody|raw|until)\b|\bpick(?:ed|ing)? at my skin until it bleeds\b(?=.*\bcut)|\bmoved (?:on )?to cutting\b", r"\bnothing (?:is |that's )?(?:keep(?:ing|s)|left to keep) me (?:alive|here|going|on this earth)\b", r"\bbetter off without (?:their|his|her|a|its) (?:mother|mom|mum|mama|father|dad|wife|husband|parent)\b", r"\b(?:my )?life is (?:something|a thing) i want to end\b|\bwant (?:my|this) life to (?:end|be over|stop)\b",
    r"\b(?:don't|no longer|didn't|never|not)(?: \w+)? (?:want|wish|care|desire|need)(?:ed|ing)?(?: to)? (?:continue |keep |go on |carry on |keep on )?(?:live|living|be alive|being alive|exist|existing|stay alive)\b(?! (?:in|at|with|near|next|alone|on|under|off|like (?:a|an|the)|through|by|there|too|as|my (?:life|best)|a (?:life|healthy)|the (?:life|rest)|without (?!him|her|them))\b)",
    r"\bhat(?:e|ing) (?:being alive|that i'm (?:still )?alive|living|existing|that i (?:woke up|exist|was born|have to live))\b(?! (?:in|at|with|near|on|alone|like this diet)\b)", r"\bbeing alive (?:is|feels|hurts) ?(?:too |so |just )?\w*", r"\bcan't (?:do|face|handle|stand|bear) (?:life|living|being alive)\b", r"\bcan't live (?:anymore|any ?longer|like this|this way|with (?:myself|this pain|the pain|the guilt))\b(?! (?:with|on) (?:these|this|the) (?:carbs|diet))", r"\bi can't (?:live|go on) without (?:him|her|them)\b(?=.*\b(?:join|be with|follow)\b)",
    r"\b(?:tried|attempted|nearly|almost|going|plan\w*|ready|decided|about|want(?:ed|ing)?) (?:to )?end(?:ed|ing)? (?:it|things|everything)" + r"\b" + _THEN_ENDS, r"\bi was (?:going|about) to (?:jump|do it|end it|hang myself)\b(?=[^.?!]*\b(?:but|until|when) (?:somebody|someone|a (?:man|woman|cop|stranger|lady|guy)|the police|he|she|they|my)\b)", r"\b(?:haven't|hasn't|never|didn't|can't|couldn't|won't|not) (?:\w+ )?(?:stop|stopped|quit) (?:cutting|self-harming|hurting myself|harming myself)\b(?! (?:out|back|down|the|my|up|it|on|carbs?|sugar)\b)", r"\bi(?:'ve| have)? attempted (?:last|again|twice|two|three|once|this|yesterday|a (?:few|couple)|before|in (?:19|20)\d\d)\b", r"\b(?:my|the) (?:last|first|previous|next|second|third) attempt\b(?! (?:at|to (?:make|bake|cook|run|lift|do|lose|diet|quit|cut|eat))\b)|\bmy attempt (?:had|didn't|failed|last|to (?:end|kill|die))\b",
    r"\b(?:i've been|i'm|i am|started|been|keep|kept|back to|already started|can't stop|couldn't stop|stop|resist\w*|think(?:ing)? (?:of|about)|urges? (?:to|for) (?:start )?|miss|(?:go(?:ing)?|went|gone) back to|turn(?:ed|ing)? to|from|with) cutting(?: again)?" + r"\b" + _THEN_ENDS + r"(?! (?:out|back|down|up|it|the|my|on)\b)", r"\bcutting (?:is|was|has become) (?:the only|my only|how i|what (?:gets|helps)|an? )", r"\bcutting (?:helps|calms) me\b|\bcutting is (?:the|my) (?:only )?(?:way|thing)\b", r"\b(?:relapsed|slipped)\b[^.?!]{0,30}\b(?:and )?(?:i )?cut\b" + _THEN_ENDS, r"\bcut(?:ting)? again\b(?! (?:on|back|out|down|carbs|sugar)\b)",
    r"\b(?:urges?|impulses?|temptation|craving|need|itching) to cut\b(?! (?:out|back|down|carbs?|sugar|calories|weight|fat|salt|meat|dairy|gluten|bread|the|up|it|on|portions?|snacks?|soda|coffee|alcohol|my (?!arms?|legs?|wrists?|skin|thighs?|self)|some|corners|all|meals)\b)", r"\bto cut (?:to feel|to cope|so i (?:can )?feel|until i bleed|because i (?:hate|feel|deserve))\b", r"\b(?:and|then|so) i cut\W*(?:$|[.!?,])",
    r"\b(?:blades?|razors?|knife|glass|scissors|needle)\b[^.?!]{0,30}\b(?:to|on|into|across|against) my (?:own )?(?:arms?|wrists?|skin|thighs?|throat|neck|legs?)\b(?![^.?!]*\bshav\w+)", r"\bcarv(?:e|ed|es|ing)\b[^.?!]{0,30}\b(?:in(?:to)?|on) my (?:own )?(?:skin|arms?|legs?|thighs?|stomach|body|wrists?)\b", r"\b(?:scratch\w+|burn\w+)\b[^.?!]{0,30}\b(?:in(?:to)?|on) my (?:own )?(?:skin|arms?|legs?|thighs?|stomach|body|flesh)\b(?=[^.?!]*\b(?:words?|lines?|lighter|cigarettes?|until|deeper|name)\b)", r"\b(?:fresh|new|deep) (?:cuts|burns|wounds) on my (?:arms?|legs?|thighs?|wrists?|stomach)\b(?![^.?!]*\b(?:cat|kitten|dog|rose|thorns?|garden|fence|oven)\b)", r"\bcut(?:ting)? (?:my )?wrists?\b", r"\b(?:cut|cutting) (?:too |so )?deep(?:er)?(?: than i meant)?\b(?=[^.?!]*\b(?:i|me|my|blood|meant|this time)\b|\W*$)",
    r"\b(?:punch|slap)(?:ing|es|ed)? myself\b(?! (?:in the (?:arm|leg) (?:for|lol))\b)", r"\b(?:hit|bang|bash)(?:ing|s|ed)? (?:myself|my head)\b(?=[^.?!]*\b(?:when i|because|until|against the wall|on purpose|over and over|so hard)\b)", r"\b(?:strangl|suffocat|asphyxiat|chok)(?:e|ed|ing) myself\b(?! on\b)", r"\b(?:delete|deleting|yeet|yeeting) myself\b(?! (?:from|off the)\b)", r"\btoaster bath\b", r"^kms\W*$|\bkms (?:right now|tonight|fr|so bad)\b", r"\b(?:relapsed? (?:on|with) sh|sh relapse|sh urges?|urges? to sh)\b",
    r"\brelaps\w+\b(?=[^?!]*\b(?:cutting|self-harm\w*|hurting myself|harming|with the (?:blade|razor))\b)|\b(?:clean from (?:cutting|self-harm\w*)|self-harm\w*)\b[^?!]*\brelaps\w+", r"\b(?:voices?|head|brain|mind)\b[^.?!]{0,25}\b(?:say(?:s|ing)?|tell(?:s|ing)? me|keeps?|scream\w*)\b[^.?!]{0,20}\b(?:die|kill (?:yourself|myself)|end it|hurt (?:yourself|myself)|not be here)\b", r"\bdanger to myself\b", r"\b(?:planning|plan) my (?:own )?(?:death|suicide|exit)\b", r"\bkeep talking about (?:dying|death|killing myself|suicide)\b", r"\bkill yourself,? so i(?:'ll| will| might| should| am|'m)\b",
    r"\b(?:i )?(?:can|could) see why (?:she|he|they) (?:killed|did)\b[^.?!]*\bi want\b", r"\bnot be here (?:anymore|for (?:christmas|my birthday|the summer|it))\b(?=[^.?!]*\b(?:want|hope|wish|rather)\b)", r"\b(?:only|main) (?:reason|thing) (?:(?:that|why) )?(?:i'm (?:still )?(?:alive|here)|i haven't (?:killed|ended|done it)|keeping me (?:alive|here))\b", r"\b(?:i'd|i would) (?:rather|sooner) (?:be dead|die)(?= than (?:live|wake|keep|go on|carry on|face|be|continue|stay|exist|do this|feel|spend|see|have)\b|\W*$)",
    r"\b(?:walk|step|jump|throw myself|run) (?:out )?(?:in front of|under|into) (?:a |the )?(?:train|bus|traffic|truck|cars?)\b", r"\bstarving myself on purpose\b(?=.*\b(?:die|death)\b)", r"\bwaiting to die\b|\bready to go\b(?=[^.?!]*\b(?:heaven|meet (?:god|jesus|my maker)|be with the lord)\b)", r"\bslowly killing myself\b(?![^.?!]*\b(?:work|diet|gym|sugar)\b)",
)
# Words that need to know whose they are.
_SUBJECT_WORDS = re.compile(r"\b(?:suicid\w*|self-harm\w*|overdos\w+)\b")

_WHEN = r"(?:tonight|right now|today|this (?:evening|morning|afternoon|weekend|week)|in (?:a few|a couple of|\d+|five|ten|twenty) (?:minutes?|hours?)|in an hour|later today|tomorrow|before (?:bed|morning)|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|after (?:work|tonight))"
_ACT = (r"(?:kill(?:ing)? myself|end(?:ing)? (?:my life|it all|it|things)|hang(?:ing)? myself|shoot(?:ing)? myself|drown(?:ing)? myself|overdos(?:e|ing)|jump(?:ing)? (?:off|from|in front of)(?! (?:keto|low|a low|paleo|carnivore|the (?:5k|treadmill|couch|sofa|diving|swing|box|bed|low)|a (?:5k|box|plane|diving)|one|my (?:bike|horse)|\w+ (?:carb )?to)\b)|slit(?:ting)? my|cut(?:ting)? my wrists?|"
        r"commit(?:ting)? suicide|tak(?:e|ing) my (?:own )?life|hurt(?:ing)? myself|cut(?:ting)? myself|harm(?:ing)? myself|do it tonight|die tonight|take them all|take all (?:of )?(?:my|the) (?:pills|meds|medications?|medicine|tablets|insulin|sleeping pills|painkillers|antidepressants)(?! (?:with|in the|at (?:once|night|the same)|every|as|before|after|on time|together|or|from now)\b))")
_IMMINENT = _rules(
    rf"\b(?:i'm|i'll|i've|and|just|finally)?\s*(?:going to|about to|planning (?:to|on)|plan to|decided to|ready to|i'll) (?:just |really |finally |actually )*{_ACT}\b(?! if\b| unless\b)", rf"\bi'm (?:ending my life|killing myself|ending it)\b(?=[^.?!]*\b{_WHEN})",
    r"\b(?:written|wrote|writing|left|leaving) (?:\w+ )?(?:a |my |the )?(?:goodbye|suicide|farewell) (?:note|letter|message)s?\b(?! to (?!(?:my|everyone|the kids|mom|mum|dad|you|him|her|them|our)\b)\w+)", r"\bsuicide note\b(?! in)", r"\bgoodbye (?:cruel )?world\b|\b(?:goodbye|bye|goodnight) forever\b(?!,? (?:to )?(?:soda|sugar|carbs|bread|coffee|wine|pizza|chocolate|junk|gluten|dairy|cigarettes|alcohol|diet|fat|pounds|jeans|cheese|meat|my (?:fat|big|old)|the (?:scale|gym)|\w+!*$))|\bgoodbye everyone\b(?![^.?!]*\b(?:vacation|weekend|trip|see you|next week|holiday|app|for now)\b)|\bgoodnight everyone\b(?=[^?!]*\b(?:sorry|forever|love you|last)\b)", r"\bthis is (?:my )?(?:goodbye|last (?:message|goodbye))\b(?! (?:on|about|for now|until)\b)|\bthis is my last (?:day|night)(?=\W*(?:$|[.!?,])|\W+(?:alive|on (?:this )?earth|with you))", r"\bby the time you (?:read|see) this\b",
    r"\bwrote letters? to my\b(?=.*\b(?:ready to die|goodbye|end|gave (?:the|my|away)|won't be)\b)", r"\bsaid my goodbyes\b", r"\b(?:my|her|his|their) last (?:night|day) (?:alive|here(?! (?:at|in|with|on)\b)|on earth)\b", r"\bno more tomorrows?\b", r"\bwon't (?:see|be here) tomorrow\b", r"\b(?:affairs in order)\b(?=.*\b(?:tonight|goodbyes?|finally|stops?|end)\b)",
    r"\bi won't be (?:here|alive|around) (?:tomorrow|anymore|much longer|in the morning|after)\b", r"\b(?:standing|sitting|i'm) on (?:a|the) (?:ledge|railing|edge of (?:a|the) (?:roof|bridge|cliff)|train tracks)\b", r"\bstanding on (?:a|the|top of a|top of the) (?:bridge|roof|tracks)\b(?![^.?!]*\b(?:photo\w*|view|sunset|walk|run|coffee)\b)|\bstanding on (?:a|the|my) balcony\b(?=[^.?!]*\b(?:jump|look(?:ing)? down|railing|over the|end it|die)\b)",
    r"\b(?:gun|knife|blade|razor|rope|noose)(?: is)? (?:in my hand|to my head|next to me|right here|in front of me|ready(?! (?:to (?:chop|cut|slice|cook|carve|dice|peel|use for|work|jump)|for (?:the|my|dinner|cooking|cardio))\b)|around my neck)\b(?![^.?!]*\b(?:chop|slice|veggies|vegetables|cook\w*|onions?|cardio|kitchen)\b)", r"\bloaded gun\b", r"\bgun in (?:the|my) (?:car|hand|lap|bag|drawer)\b(?=[^.?!]*\b(?:me|i|nobody|alone)\b)", r"\b(?:holding|got|have|bought) (?:a|the|my) (?:knife|gun|blade|razor|rope|noose)(?: \w+){0,4} (?:to (?:do it|end|kill (?:my|him|her)|use(?! for))|ready(?! (?:to (?:chop|cut|slice|cook|carve|dice|peel)|for)\b)|and i(?:'m| am|'ll| want to die| can't| don't want)?(?! (?:love|like|need|use|also|cook|chop|want to (?:cook|chop|learn))\b))\b(?![^.?!]*\b(?:chop|slice|veggies|vegetables|cook\w*|workouts?|love it)\b)",
    rf"\bi (?:have|'ve got|got|saved|bought|collected|stockpiled) (?:\w+ ){{0,4}}{_PILLS} (?:\w+ ){{0,3}}(?:ready|to (?:do it|end|kill|die|take them all|overdose))\b", rf"\b(?:pills|tablets|meds|medication|painkillers) (?:are |is |all )?(?:(?:laid |lined |counted )?out(?! (?:of|and i need|already|for|\w+ stock)\b)|lined up|counted out|in front of me|in my hand|ready)\b(?! (?:at the pharmacy|for (?:pick ?up|the|my|tomorrow|refill|a refill)|to (?:pick up|be picked|refill)|next to my)\b)(?=[^.?!]*\b(?:i|me|not ok|tonight)\b|\W*(?:lol|haha|lmao)*\W*(?:$|[.!?]))(?![^.?!]*\b(?:pharmacy|refill|pick(?: them)? up|trip|breakfast|organizer)\b)", r"\bi (?:have|got|hav) a plan (?:to|for) (?:kill|end|die|do it|dying|ending|killing)\b",
    rf"\bi(?:'ve| have)? (?:got |have )?(?:the|my|all the|all my) (?:pills|tablets|meds|medication|painkillers|sleeping pills) (?:out|lined up|counted out|in front of me|in my hand|with me|ready)\b(?! (?:for (?:the|my|a|tomorrow)|every|each|so i|by the|in the (?:morning|evening)|on (?:the|my|this) (?:trip|flight|plane)|at (?:work|the)|in (?:my|case)|when|while|next to)\b)",
    r"\bhave (?:what|everything) i need to (?:make it (?:all )?(?:go away|stop|end)|end|do it)\b", r"\b(?:going to|about to|off to) sleep\b[^.?!]{0,30}\bnot (?:planning on |going to be |going to )?wak(?:e|ing) up\b(?! (?:early|before|until|at|till|for)\b)", r"\bnot planning (?:on|to) (?:wak(?:e|ing) up(?! (?:early|before|until|at|till|for)\b)|be(?:ing)? here(?! (?:for|on|at|until|next|when)\b))\b",
    r"\bi(?:'ve| have)? (?:just |already )?(?:cut|slit) my (?:wrists?|throat)\b(?! while)", r"\bi'm bleeding out\b", rf"\b(?:just )?tried to (?:kill myself|end my life|hang myself|overdose)\b(?=[^.?!]{{0,30}}\b(?:{_WHEN}|just now|ago|last night|yesterday)\b)", r"\bi just tried to (?:kill myself|end my life|hang myself|overdose)\b",
    r"\beverything i need to (?:end it|do it)\b(?! (?:on my own|myself|right|well|at home)\b)", r"\bi'll be dead (?:before|by|when|soon|tonight|tomorrow)\b", r"\b(?:scared|afraid|terrified) of what i(?:'m going to| might|'ll) do\b", r"\b(?:can't|shouldn't) be (?:trusted|left) alone\b(?! (?:with|around|near|in (?:a|the) (?:kitchen|bakery)) (?:a |an |the |my |any |some |that |these |those )?(?!knife|pills|meds|gun|rope|razor|blade|my own|myself)\w+)", r"\bdon't feel safe being (?:by myself|alone|on my own)\b", r"\b(?:head|voices?|brain|mind)\b[^.?!]{0,15}\btelling me to (?:do it|jump|die|end|kill|hurt)\b",
    r"\b(?:knife|razor|blade|pills|rope|gun)\b[^.?!]{0,40}\bwith me\b(?=.*\b(?:don't want to do|think i will|going to|do it)\b)", r"\bnearly hurt (?:him|her|them|my \w+)(?: just now| again| today)\b", r"\bgo(?:ing)? through with (?:it|killing|ending)\b(?=[^.?!]*\b(?:i|i'm|me|myself|tonight)\b)(?![^.?!]*\b(?:marathon|race|surgery|signed up|wedding|divorce|diet|program|interview|move)\b)", r"\b(?:picked|chose|set|have) (?:the|a|my) (?:day|date)\b[^.?!]{0,30}\b(?:die|end (?:it|my)|do it|go)\b", rf"\bsav(?:ing|ed) up (?:my |the |all my )?{_PILLS}\b",
    rf"\b(?:almost|nearly) (?:ended my life|killed myself|did it|jumped|took them all|took all my {_PILLS})\b(?=[^.?!]*\b(?:last night|today|tonight|yesterday|this (?:morning|week)|just now)\b)(?![^.?!]*\b(?:steps?|\d+k|miles?|goal|pounds|class|workout|burpees)\b)", r"\btoo late by then\b(?! (?:to|for) )|\bby then (?:it'll|it will) be (?:too late|over)\b", rf"\b{_PILLS} (?:in my lap|on my lap|beside me|next to me)\b|^(?!.*\b(?:prescribed|doctor|statins?|pharmac\w+|vitamins?)\b).*\bdon't know if i'm going to take them\b",
    r"\b(?:already )?started (?:cutting(?! (?!myself|again|and|my (?:arms?|legs?|wrists?|skin|thighs?))\w+)|taking (?:them|the pills)|hurting myself)\b[^.?!]*\bcan't stop\b", r"\bready to die\b(?=.*\b(?:letters?|goodbye|tonight|gave|today)\b)|\b(?:letters?|goodbyes?|gave (?:the|my|away))\b.*\bready to die\b",
    r"\b(?:can't|don't think i can|not sure i can) (?:keep myself|stay|be|keep) safe\b", r"\bi(?:'m| don't feel)? (?:not )?safe (?:with|from) myself\b", r"\b(?:afraid|scared|worried|terrified) (?:that )?(?:i'll|i might|i'm going to|i'd) (?:actually |really )?(?:kill|hurt|harm) myself\b", r"\bi might (?:actually |really |just )?(?:kill|end) (?:myself|my life|it all)\b", r"\b(?:can't|don't) trust myself (?:not to|alone|tonight|right now|to be alone|around)\b", r"\bi might do something (?:stupid|bad|to myself|i can't take back)?(?=\W|$)(?=.*\b(?:trust|alone|tonight|myself|scared)\b|$)",
    r"\b(?:going to|about to) (?:kill|stab|shoot|strangle|attack|hurt) (?:him|her|them|someone|somebody|everyone|people|my (?:husband|wife|partner|kids?|son|daughter|mother|father|mom|dad|boss|neighbou?r|ex))\b(?! (?:if|when|for)\b)", r"(?<!don't )(?<!not )(?<!never )(?<!didn't )(?<!wouldn't )\bwant to (?:hurt|kill|stab|shoot|attack) (?:someone|somebody|people|him|her|them|my (?:husband|wife|partner|kids?|son|daughter|mother|father|mom|dad|ex))\b(?!'s? feelings|'s| feelings)",
    r"^(?=.*\b(?:gone|passed|died|dead|heaven|buried|widow\w*|funeral)\b).*\b(?:i'm going to|i'll|ready to|time to) (?:join (?:my \w+|him|her|them)|be with (?:him|her|them|my (?:husband|wife|son|daughter|baby|late \w+) again)) (?:tonight|today|tomorrow|soon|now|this week)\b(?! (?:for|at (?:dinner|the)|on)\b)", r"\btonight(?:'s| is| might be| will be) the night\b(?=.*\b(?:bye|goodbye|die|end it|last (?:day|night|time|message))\b)", r"\bstop (?:hurting|the pain|the hurting) (?:for good|forever|once and for all|permanently)\b(?<!knee to stop hurting for good)(?<!back to stop hurting for good)(?<!hip to stop hurting for good)(?<!foot to stop hurting for good)(?<!neck to stop hurting for good)(?<!feet to stop hurting for good)",
    r"\b(?:kids|children|them|her|him|mum|mom|wife|husband|family|someone|somebody|they|she|he)(?: that| who| to| will| has to| have to|'ll)? (?:(?:finds?) (?:me|my body)|found my body)\W*(?:$|[.!?,])", r"\bi'm not (?:carrying|going) on (?:after|past|beyond)\b", r"\bi won't (?:be alive|see (?:tomorrow|the morning|the weekend|next (?:week|month|year)|(?:mon|tues|wednes|thurs|fri|satur|sun)day|christmas))\b",
    r"\blast day on earth\b", r"\bgoing through with it (?:this time|tonight|today|now)\b(?![^.?!]*\b(?:marathon|race|surgery|signed up|wedding|divorce|diet|program|interview|move)\b)", r"\bletters? (?:is|are) written\b|\bmade my peace\b(?=.*\b(?:letters?|clean|goodbye|thank you|ready)\b)",
    r"\bthere won't be anyone to use it\b|\b(?:by tomorrow|after (?:today|tonight)),? i won't be (?:here|around|alive|anywhere)\b", r"\bno more (?:being )?a burden\b", r"\bgoing to do it\b(?=[^.?!]*\b(?:nobody|no one|alone)\b)(?![^.?!]*\b(?:diet|pounds|marathon|program|fast|workout|on my own)\b)(?<!pounds and i'm going to do it)", r"\blast (?:message|text) (?:from me|you'll (?:get|see)|i'll (?:ever )?(?:send|write))\b", r"\btells? my (?:mum|mom|dad|mother|father|wife|husband|kids|family|parents|son|daughter|sister|brother)\b[^.?!]{0,30}\b(?:wasn't|isn't|was never) (?:her|his|their) fault\b",
    r"\b(?:got|have|bought|found) what i need(?:ed)?\b(?=[^.?!]*\b(?:to be over|nerve|calm)\b)(?<!great, i got what i needed)(?<!class, i got what i needed)(?<!store and got what i needed)", r"\bif i don't (?:reply|message|text|answer|respond|write)\b[^.?!]{0,60}\b(?:through with it|i'm gone|i'm dead)\b", r"\bsaid (?:bye|goodbye)\b(?=[^.?!]*\bwithout (?:them|him|her|anyone) (?:knowing|noticing)\b)|\bsaid (?:all )?my goodbyes\b", r"\b(?:affairs|papers|everything|things|will|house)(?: \w+){0,3} in order\b(?=.*\b(?:will|funeral|decided|goodbye|won't|ready)\b)",
    r"\b(?:going to|tonight i'm going to|about to) (?:join (?:my (?:wife|husband|mom|mum|mother|dad|father|son|daughter|baby|brother|sister|partner)|him|her|them)|be with (?:him|her|them))\b(?=.*\b(?:without (?:him|her|them)|heaven|other side|died|passed|gone|again at last)\b)|\b(?:going to|about to) be with my (?:wife|husband|mom|mum|mother|dad|father|son|daughter|baby|brother|sister|partner)\b(?=.*\b(?:without (?:him|her|them)|heaven|other side|again at last)\b)",
)
_PLACE = r"(?:bridge|roof(?:top)?|ledge|overpass|balcony|platform|parking (?:garage|structure|deck|lot roof)|cliff|tracks|railway|railing|tower|pier|dam)"
_IMMINENT += _rules(
    r"\btook (?:them|it)\b[^?!]{0,20}\ball of (?:them|it)\b(?=[^?!]*\b(?:sleepy|bye|goodbye|sorry|love you|done)\b)", r"\bstood on (?:a|the|top of a|top of the) (?:bridge|roof|tracks|ledge|railing)\b(?![^.?!]*\b(?:photo\w*|view|sunset|yesterday|selfie)\b)", rf"\b{_WHEN}[^.?!]{{0,20}}\bi'm ending (?:it|my life|things)\b", r"\blast thing i(?:'m|'ll)? (?:ever )?(?:going to |will )?(?:ever )?(?:type|write|say|send|post)\b", rf"\b{_PLACE}\b[^?!]{{0,40}}\b(?:going to|about to|ready to|want to|might) jump\b", r"\bwalk(?:ing|ed)? (?:to|onto|on|along) the (?:train |railway |railroad )tracks\b(?![^.?!]*\b(?:photo\w*|dog|trail|exercise|steps)\b)",
    r"\bby the time (?:you|any(?:one|body)?(?: of you)?|they|he|she) (?:reads?|sees?|gets?) this\b", r"\bnot coming (?:home|back) from this\b|\bdon't think i'm coming (?:home|back)\b(?=[^?!]*\b(?:bridge|tracks|roof|this one)\b)",     r"\b(?:already |just |i )(?:have |'ve )?swallowed (?:the|all the|my|a lot of|all my) (?:pills|tablets|meds)\b(?! with)|\bswallowed the pills\b", r"\buse (?:it|this|the (?:gun|knife|razor)|one) on myself\b", r"\bi'm going to jump\b(?! (?:in|into|on|rope|off the (?:boat|dock|couch|treadmill)|back|start|for|from|right|ahead|out of bed|at|through|to|up)\b)", r"\b(?:don't|didn't|not) (?:plan|expect|intend|want|planning|expecting) (?:on |to )?(?:being|be) (?:alive|around|here) (?:by|for|past|after|at|next|come|much)\b(?! (?:the (?:meeting|class|call)|dinner|lunch)\b)",
    r"\bfinds? my body(?=\W*(?:$|[.!?,;]|and\b|in the\b|when\b|after\b|tomorrow|before))|\bwho finds? me (?:dead|like (?:this|that))\b", r"\bthat(?:'s| is) when i(?:'ll| will)? die\b|\bset a date\b(?=.*\b(?:die|end it|my life|goodbye)\b)", r"\b(?:roof|ledge|bridge|balcony)\b[^.?!]{0,40}\b(?:don't|not|won't) (?:intend|plan|planning|going|want|be) ?(?:to )?(?:come|take the stairs|climb|coming) (?:back )?down\b", r"\b(?:can't|won't|not going to) (?:stay|be|remain) in this world\b|\bin this world (?:past|after) (?:today|tonight|tomorrow)\b|\b(?:can't|won't) (?:stay|be here) past (?:today|tonight|tomorrow)\b", r"\b(?:took|taken) (?:something|enough)\b[^.?!]{0,30}\b(?:won't|don't|not|never) wake\b", r"\b(?:got|have) what i need\b[^.?!]{0,20}\bto (?:do|end) it\b",
    r"\b(?:gun|pistol|rifle|shotgun)\b[^.?!]{0,25}\b(?:in my (?:mouth|lap|hand)|to my (?:temple|chin)|on the (?:table|bed|nightstand|counter) (?:in front|next|beside)|in front of me|is loaded|loaded and)\b", r"\bloaded (?:gun|pistol|rifle|shotgun)\b|\b(?:gun|pistol) is loaded\b", r"\b(?:the |a )?noose\b(?! (?:around|of) (?:debt|the economy))", r"\btied (?:a|the|my) (?:rope|sheet|belt)\b|\brope (?:is tied|broke)\b|\ba rope and (?:a place|a tree|i)\b|\brope\b[^.?!]{0,40}\bkeep (?:looking|staring) at it\b|\b(?:bought|got) (?:a |some )?rope to (?:hang|do|end|kill)\b",
    r"\b(?:holding|pressing|got|have) (?:a|the|my) (?:knife|blade|razor)\b[^.?!]{0,15}\b(?:to|on|against|at) my\b",
    rf"\b(?:i'm|i am|standing|sitting|here|parked)\b(?: \w+){{0,4}}? (?:on|at|off|by) (?:a |the |top of (?:a |the )?|the top of (?:a |the )?|the edge of (?:a |the )?|my )?(?:\w+ )?{_PLACE}\b(?=[^.?!]*\b(?:jump|goodbye|end it|die|done|do it|can't|ready)\b)|\b(?:jump|goodbye|die|ready)\b[^.?!]*\bi'm (?:on|at) (?:a |the |top of the )?{_PLACE}\b", rf"\bi'm (?:at|on) (?:a |the )?(?:bridge|roof|ledge|tracks) (?:now|right now|already)\b(?![^.?!]*\b(?:mile|run|walk|view|sunset|photo|lunch)\b)",
    r"\b(?:sitting|standing|lying|laying|waiting) (?:on|by|at) the (?:train |railroad )?tracks\b", r"\bwaiting for the train (?:so i can|to) (?:jump|hit|end|come and)\b", r"\b(?:crash|drive|wreck|flip|driving|crashing) (?:my|the) car (?:on purpose|off (?:a|the)|into (?:a|the) (?:tree|wall|river|lake|bridge|pole|truck))\b", r"\bgarage\b[^.?!]{0,40}\b(?:engine|exhaust|car)(?: is)? (?:is )?(?:running|on)\b|\b(?:engine|car)(?: is)? running\b[^.?!]{0,25}\b(?:closed |shut )?garage\b|\bturned (?:on the gas|the gas on)\b[^.?!]*\b(?:windows?|doors?)\b",
    rf"\b(?:going to|about to|ready to|will|i'll|gonna|want to|could|i'm|tonight i'm) (?:just )?(?:tak(?:e|ing)|swallow(?:ing)?|down(?:ing)?) (?:every (?:single )?(?:pill|tablet|one of (?:my|these|the) pills)|all (?:of )?(?:my|the|these|those|them|his|her) ?(?:pills|meds|tablets|sleeping \w+|medications?|insulin)?|the (?:whole|entire) (?:bottle|pack|box)|a whole (?:bottle|pack|box)|(?:a|this) (?:whole )?bottle of (?:pills|\w+))(?! ?(?:supplements|vitamins|probiotics)\b)\b(?! (?:supplements|vitamins|with (?:breakfast|lunch|dinner|food|water|a meal)|in the morning|at (?:once|night|bedtime)|together|from now|every|as (?:prescribed|directed)|on time|like|each|supplements|vitamins)\b)", r"\bpills\b[^.?!]{0,15}\ball of them (?:tonight|now|today)\b|\b(?:could|might) take them all\b", r"\bstaring at (?:the|my|a) (?:bottle|pills|blade|knife|gun|rope)\b",
    r"\b(?:it's|its|it is) done\b[^?!]{0,15}\bi took (?:them|all|it)\b|\bi took (?:them all|all of them)\b(?=[^?!]*\b(?:goodbye|sorry|done|love you|pills|sleepy|die|help|scared)\b)|\b(?:overdosed|took an overdose|od'd) on purpose\b|\btook (?:them|it|all of it|the pills) on purpose\b", r"\b(?:leave|leaving|left|exit\w*|depart\w*|quit\w*) (?:this|the) (?:world|earth|planet)\b(?! (?:a |better|of (?!living))\b)", r"\b(?:going|go) to heaven (?:tonight|soon|today|now)\b|\bin heaven (?:soon|tonight|tomorrow)\b", r"\bby the time (?:anyone|anybody|someone|somebody|they|you|he|she|my \w+) (?:finds?|sees?|gets?|reads?|comes?|wakes?)\b(?=[^.?!]*\b(?:dead|gone|late|over|me)\b)", r"\b(?:find|finds|found) me\b[^.?!]{0,20}\btoo late\b|\buntil it's too late\b(?=[^.?!]*\b(?:find|know|notice)\b)",
    r"\bi(?:'m| am) joining (?:my (?:late |dead )?(?:husband|wife|mom|mum|dad|son|daughter|baby)|him|her) (?:in heaven|tonight in|on the other side|soon in)\b", r"\b(?:gave|given|giving) (?:away|my)\b[^.?!]{0,40}\b(?:and )?said (?:my )?goodbyes?\b|\bsaid goodbye to (?:everyone|my kids|my children|my family|the kids)\b(?![^.?!]*\b(?:airport|school|work|vacation|trip|flight|college|bus|camp|daycare)\b)", r"\bmy (?:suicide|goodbye) note\b|\bsuicide note i wrote\b|\bthe note i (?:wrote|left)\b(?=[^.?!]*\b(?:goodbye|suicide|found)\b)", r"\b(?:next time|this time) i won't (?:fail|survive|mess it up|miss)\b(?![^.?!]*\b(?:diet|test|exam|weigh|goal)\b)", r"\bi(?:'ve| have)? (?:got )?(?:have )?a plan to (?:end|kill|die|do it|do the same|join|hurt)\b", r"\bi'm (?:killing myself|ending my life|doing it) (?:now|right now|tonight|today)\b",
)
_HITS = r"(?:hit(?:s|ting)?|beat(?:s|ing|en)?|chok(?:e|es|ed|ing)|strangl\w+|slap(?:s|ped|ping)?|punch(?:es|ed|ing)?|kick(?:s|ed|ing)?|shov(?:e|es|ed|ing)|attack(?:s|ed|ing)?|abus(?:es|ed|ing)|hurt(?:s|ing)?|rap(?:ed|es|ing)|molest\w*|threaten(?:s|ed|ing)? (?:to (?:kill|hurt) )?)"
_WHO_HARMS = r"(?:he|she|they|he's|she's|they're|he'll|she'll|he'd|she'd|my (?:husband|wife|partner|boyfriend|girlfriend|dad|father|mom|mum|mother|brother|sister|son|daughter|ex|uncle|stepdad|stepfather|stepmom|roommate|boss|caregiver|carer))"
_HARMED = _rules(
    rf"\b{_WHO_HARMS}(?: (?:\w+ ){{0,8}}?|[^.?!]{{0,30}}? )(?:just |is |are |has |keeps? |kept |always |has been |been |was |still |and )*{_HITS} ?me\b(?! like\b)(?<!tight, they hurt me)(?<!shoes hurt me)(?<!heels hurt me)(?<!small, they hurt me)(?<!new, they hurt me)(?! (?:at|to|in (?:a|the) (?:game|match|race)|with (?:a|the) (?:question|news|idea|bill|ball)|up\b))",
    rf"\b{_WHO_HARMS}(?:'d|'ll| would| will| said he'd| says he'll| said she'd)? (?:kill|find and kill|hurt) me\b(?! (?:if|when) i (?:eat|ate|don't|forget|skip|miss|touch|buy|'m late))(?<!they hurt me)", r"\bsaid (?:he'd|she'd|they'd|he'll|she'll|they'll|he would|she would|he's going to|she's going to) (?:kill|hurt|find) me\b", r"\b(?:he|she|my (?:husband|wife|partner|boyfriend|girlfriend|ex|dad|father|stepdad|brother|son))(?:'s| is|'ll| will)? (?:going to |gonna )?(?:kill|hurt) me (?:when|if i (?:leave|tell|call|go|report|divorce|say)|one day|for real)\b", r"\bhands? (?:a?round|on|at) my (?:neck|throat)\b", r"\bthings to me (?:that )?i don't want\b", r"\bthrew (?:a|the|his|her) \w+ at me\b", r"\bhiding (?:in|from)\b(?=[^.?!]*\b(?:bathroom|bedroom|closet|him|her|them|car)\b)(?=.*\b(?:he|she|they|him|her)\b)(?![^.?!]*\b(?:chocolate|snacks?|cookies|candy|kids want|chips|eating)\b)",
    r"\b(?:was|been|got|being|i was) (?:sexually )?(?:assaulted|raped|attacked|molested|abused|beaten|mugged)\b(?! by (?:a )?(?:bug|virus|mosquito))", r"\bhurt(?:ing|s)? me (?:again|and the kids|if i)\b", r"(?<!diet )(?<!plan )(?<!app )(?<!program )(?<!doctor )(?<!stomach )(?<!body )\b(?:won't (?:let me eat|give me (?:any )?food)|decides when i'm allowed|locks? (?:the|up the) (?:fridge|food|kitchen))\b", r"\b(?:tell(?:ing|s)?|told) me to (?:kys|kill myself|die)\b", r"\b(?:he|she|my (?:dad|mom|mum|father|mother|husband|wife|partner|stepdad))\b[^.?!]{0,30}\b(?:hits|beats|hurts) us\b", r"\bthreatening (?:to|me)\b(?=[^.?!]*\b(?:me|my)\b)", r"\bfound out where i live\b", r"(?<!diet )(?<!plan )(?<!app )(?<!program )(?<!doctor )(?<!stomach )(?<!body )(?<!website )(?<!screen )(?<!it )\bwon't let me (?:buy|eat|leave|see)\b|\btakes my (?:paycheck|money|phone)\b",
    r"\b(?:followed|following) me home\b", r"\b(?:gets?|got|getting|being) (?:rough|violent|physical|aggressive) with me\b", r"\bthrows? (?:things|stuff|plates|\w+) at me\b", r"\b(?:he's|she's|they're) (?:outside|downstairs|at the door|banging)\b(?=.*\b(?:banging|lights off|smashing|hiding|scared|shouting)\b)", r"\bblack eye\b(?=.*\b(?:he|she|drinks?|cupboard|door)\b)", r"\b(?:put|puts|laid|lays) (?:his|her|their) hands on me\b", r"\bfinish what (?:he|she|they) started\b", r"\bsmashing (?:things|up|the \w+)\b(?=.*\b(?:he|she|he's|she's|hiding|kids|downstairs)\b)",
    r"\b(?:frightened|scared|terrified) of (?:him|her|them|my (?:husband|wife|partner|son|daughter|dad|father|stepdad|ex|boyfriend|girlfriend|carer))\b", r"\btaken? my phone off me\b", r"\b(?:my (?:carer|caregiver|husband|wife|partner|son|daughter|dad|mum|mom|boyfriend|girlfriend)|he|she) (?:pinches|grabs|pushes|drags|shakes|spits (?:at|on)) me\b", r"\bscared to go home\b",
    r"\bi'm (?:not safe|in danger)\b(?! (?:from|with) myself| of (?:becoming|getting|gaining|losing|developing|being)| to eat)", r"\bi don't feel safe (?:at home|here|with (?:him|her|them|my \w+)|right now|tonight)\b", r"\b(?:someone|somebody) is (?:trying to (?:hurt|kill)|following(?! me on (?:the|this|my)? ?(?:app|instagram|facebook|strava|social))|breaking in|attacking)\b",
)

_TOO_MUCH = (r"(?:too many|too much|(?:a |the |an |my |his |her )?(?:whole|entire|full) (?:bottle|pack|packet|box|bunch|strip|blister)(?: of)?|double|two doses|a double dose|an extra dose|a handful|handfuls|a lot of|lots of|loads of|a load of|a bunch of|a bottle of|the rest of|every(?: single)?|"
             r"all (?:of )?(?:my|the|his|her|their|those|these)(?! (?:\w+ ){0,3}(?:with|on time|as (?:prescribed|usual|directed|normal|always)|like (?:i'm|always|normal|usual)|this morning|in the morning|before bed|at bedtime|every|each|today as))|(?:[5-9]|\d{2,})(?! ?(?:mg|mcg|iu|g|grams?|ml|milligrams?|units? of|%|minutes?|hours?|days?|years?|am|pm)\b)|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty)")
_TOOK = r"(?:took|taken|swallowed|downed|popped|injected|ate|drank|had|gave (?:myself|him|her|them|(?:my|the) \w+)|given (?:myself|him|her))"
_DRUG = (r"(?:pills?|tablets?|capsules?|meds|medications?|medicines?|insulin|metformin|paracetamol|acetaminophen|tylenol|ibuprofen|advil|aleve|aspirin|antidepressants?|sleeping (?:pills?|tablets?)|painkillers?|opioids?|xanax|valium|ativan|ambien|benadryl|statins?|warfarin|blood thinners?|beta blockers?|antihistamines?|"
         r"(?:iron|vitamins?|magnesium|potassium) (?:pills?|tablets?|capsules?|gummies)|gumm(?:y|ies) vitamins|vitamins|gummies|supplements)")
_SOMEBODY = (r"(?:he|she|they|him|her|someone|somebody|the baby|my (?:friend|sister|brother|mom|mum|mother|dad|father|husband|wife|partner|boyfriend|girlfriend|"
             r"son|daughter|child|kid|baby|toddler|cousin|aunt|uncle|grand\w+|niece|nephew|roommate|neighbou?r))")
_BODY = _rules(
    rf"\b{_TOOK}\b(?: \w+){{0,3}}? {_TOO_MUCH}\b(?: \w+){{0,4}}? {_DRUG}\b(?! (?:every|each|a) (?:day|night|morning|week))", rf"\b(?:i'm|he's|she's|been|keep|kept) taking (?:too (?:many|much)|a handful of|the whole|all (?:of )?(?:my|the))(?: \w+){{0,3}} {_DRUG}\b(?! (?:with|in the|every|as|at once|together|before|after)\b)", rf"\b{_TOOK}\b[^.?!]{{0,25}}\b(?:my |his |her |the )?{_DRUG}\b[^.?!]{{0,20}}\b(?:twice|two times|double|too many)\b(?! (?:a|per|daily|today|every|each)\b)",
    rf"\b(?:double|two) dos(?:e|es|ed)\b(?: \w+){{0,3}} {_DRUG}\b(?! (?:as|like|every)\b)(?<!prescribed)", rf"(?:^|[,.;!?] ?|\b(?:and|but|so|i|i've|accidentally|he|she|just)(?: \w+)? )doubled (?:up )?(?:on )?(?:my|his|her) {_DRUG}\b", rf"\b(?:accident\w*|by mistake|forgot|not thinking)\b[^.?!]{{0,40}}\b(?:took|taken|injected|gave)\b[^.?!]{{0,20}}\b(?:two|2|three|3|double|twice|an extra|another|both|extra|again|a second|too much|too many)\b(?![^.?!]*\b(?:vitamins?|supplements?|fish oil|omega|probiotics?|magnesium|calcium|collagen|fiber)\b)(?<!vitamins twice)|\b(?:took|taken|injected)\b(?![^.?!]*\b(?:vitamins?|supplements?|fish oil|omega|probiotics?|magnesium|calcium|collagen|fiber)\b)[^.?!]{{0,20}}\b(?:two|2|three|3|double|twice|an extra|another|both|a second)\b[^.?!]{{0,30}}\b(?:by accident|accidentally|by mistake|instead of one)\b",
    r"\b(?:took|swallowed|downed) (?:the|a|my|his|her) (?:whole|entire|full) (?:bottle|pack|packet|box)\b(?! of (?:water|wine|milk|juice|cookies|chips|gum|mints|crackers|soda))", r"\btook every (?:pill|tablet|one)\b|\b(?:took|swallowed) everything in (?:the|my) (?:medicine )?cabinet\b", r"\b(?:injected|took|gave (?:myself|him|her)) \d+ units\b[^.?!]{0,30}\binstead of\b", r"\b(?:warfarin|blood thinners?|insulin|digoxin|blood pressure (?:pills?|meds|medication)|heart (?:pills?|meds|medication)) twice(?! (?:a|per|daily|each|every)\b)|\b(?:toddler|baby|kid|child|son|daughter|grandson|granddaughter|grandchild|(?:\d+|two|three|four|five|six) (?:yr|year|month)s?[ -]old)\b[^.?!]{0,20}\b(?:swallowed|ate|eaten|got in(?:to)?|took|drank|had)\b[^.?!]{0,40}\b(?:pills?|tablets?|meds|medication|vitamins|gummies|edibles)\b", r"\b\d+ units too many\b|\btoo many units\b|\b(?:too much|double(?: my)?|twice my|wrong) insulin\b(?=[^.?!]*\b(?:took|gave|injected|taken|shaky|shaking|feel|help|what)\b)|\b(?:took|gave myself|injected)\b[^.?!]{0,15}\b(?:too much|double(?: my)?|twice my|the wrong) insulin\b",
    rf"\b(?:mixed up|mixed-up|confused|mistook)\b[^.?!]{{0,50}}\b(?:took|injected|gave|taken)\b", rf"\b(?:gave|given) (?:my|the|him|her|our) ?\w*(?: \w+){{0,3}} (?:too much|too many|a double|double|an adult|the wrong|twice)\b(?=[^.?!]*\b(?:dose|{_DRUG}|medicine|syrup|drops)\b)", rf"\b(?:took|taken|gave|given|injected)\b[^.?!]{{0,20}}\bwrong (?:insulin|dose|pills?|meds|medications?|medicine|tablets?|pen)\b|\btook the wrong (?:one|pen)\b(?=.*\b(?:insulin|pen|pills?)\b)|\b(?:insulin|pen|pills?)\b.*\btook the wrong (?:one|pen)\b", rf"\btook extra (?:\w+ )?(?:pills?|tablets?|insulin|painkillers?)\b",
    r"\b(?:i|he|she|they|i've|i'm|think i|might have|may have|have|has|just|accidentally)(?: \w+){0,2} (?:overdosed|overdosing|took an overdose|taken an overdose)\b", r"^(?:think i )?overdosed\b|\boverdosed on (?:my|his|her|their|the)\b", r"\b(?:took|taken|taking) an? (?:accidental )?overdose\b", rf"\b{{somebody}}(?: \w+){{0,2}} overdosed\b(?! (?:last (?:year|summer|month|week)|years?|and died|in (?:19|20)\d\d)\b)".replace("{somebody}", _SOMEBODY),
    r"\b(?:drank|swallowed|drunk|ate|inhaled)(?: \w+){0,3} (?:bleach|poison|antifreeze|detergent|disinfectant|pesticide|batteries|a battery|drain cleaner|paint (?:thinner|stripper)|gasoline|petrol|(?:hand )?sanitizer|cleaning (?:fluid|products?|solution|spray)|ammonia|lighter fluid|windex|lysol|(?:laundry|tide) pods?|nail polish remover|rubbing alcohol)\b", r"\bcarbon monoxide (?:alarm|detector)\b[^.?!]*\b(?:going off|beeping|headache|dizzy|went off)\b", r"\b(?:ate|eaten|eating)(?: \w+){0,3} (?:mushrooms?|berries|plants?) (?:from|in|out of) (?:the|my|our) (?:yard|garden|woods|park|forest)\b", r"\bcan't stop (?:throwing up|vomiting|being sick)\b",
    r"\b(?:(?:i|he|she|they) )?can't (?:i |he |she |properly |really |even )?breathe?\b(?! (?:because of the (?:heat|smell)|through my nose|life|fire|easy|new)\b)", r"\b(?:trouble|difficulty|hard time|struggling|hard) (?:to )?breath(?:e|ing)\b", r"\bnot breathing\b|\bdon't think (?:he's|she's|they're) breathing\b|\bnosebleed\b(?=[^.?!]*\b(?:won't stop|hours?|pouring|soaked|blood thinners?)\b)|\b(?:flat out|lying|face down|collapsed) on (?:the|his|her) (?:floor|driveway|ground|street|sidewalk|road|pavement|stairs)\b[^.?!]{0,40}\bnot (?:moving|responding)\b|\bstopped breathing\b(?! (?:for a second|when i saw)\b)|\bbarely breathing\b|\bgasping for (?:air|breath)\b|\bno pulse\b|\bcan't find (?:a|his|her|the) pulse\b|\bisn't breathing\b", r"\bbreathing (?:weird|funny|really fast|very fast)\b", r"\bshort(?:ness)? of breath (?:and|with|right now)\b", r"\bcan't catch my breath\b",
    r"\b(?:chest pains?|(?:pains?|pressure|tightness|heaviness) (?:in|on|across) (?:my |the |his |her )?chest|chest (?:tightness|pressure)|elephant (?:is )?(?:sitting|standing|on)(?: on)? (?:my|his|her|the) chest|chest hurts(?: really| so)? (?:bad|badly|much|a lot|when i breathe)|(?:my|his|her) chest (?:so |is |feels |really |very )+(?:tight|heavy)|chest is (?:really |so |very )?tight|chest is crushing|crushing chest|my chest (?:hurts|is (?:tight|hurting|killing|heavy|pounding))|(?:tightness|pressure|crushing(?: pain)?|heaviness) in my chest)\b(?! (?:last|years?|months?|weeks?|in 20)\b)",
    r"\b(?:throat|tongue|lips?|face|airway)(?: \w+){0,2} (?:is|are|feels?|keeps?|started|has|have)? ?(?:closing|closed|swelling|swollen|swelled)(?: up)?\b", r"\b(?:still )?swelling up\b(?=[^.?!]*\b(?:help|epi|throat|face|she|he|can't)\b)", r"\bused (?:my|her|his|the) epi ?pen\b", r"\banaphyla\w+\b(?! (?:risk|card|policy)\b)", r"\b(?:severe|bad|serious) allergic reaction\b", r"\bhaving an allergic reaction\b",
    r"\b(?:having|think (?:it's|i'm having|he's having|she's having)|it's|is this|had) (?:a |another )?(?:heart attack|stroke|seizure)\b(?! (?:last|years?|months?|\d+|in (?:19|20)\d\d|at (?:age )?\d+|at age|back|when (?:i|he|she|they) (?:was|were)|as a|because|thinking|when i saw|looking|over|about)\b)|\b(?:is|was) (?:seizing|convulsing|fitting)\b|\bfitting on the floor\b|\b(?:she's|he's) (?:fitting|seizing|convulsing)\b|\bconvulsions?\b", r"\b(?:face is drooping|slurr(?:ed|ing) (?:my |his |her )?(?:speech|words)|can't (?:move|feel) (?:my|one|his|her) (?:left |right )?(?:arm|leg|side|face))\b",
    rf"\b(?:i|he|she|they|he's|she's|is|{_SOMEBODY}|and|just|suddenly|has|have|just) (?:just |suddenly |now |is |has |'s |was found |went )*(?:unconscious|unresponsive|collapsed)\b(?<!screen is unresponsive)(?<!page is unresponsive)(?<!app is unresponsive)(?<!website is unresponsive)(?<!phone is unresponsive)(?<!button is unresponsive)(?<!cake collapsed)(?<!bread collapsed)(?<!tent collapsed)(?<!chair collapsed)(?<!shelf collapsed)(?<!economy collapsed)(?! (?:on (?:the|my) (?:couch|sofa|bed)|into (?:bed|a chair)|snack\w*|eating|habits?|bias|in laughter|laughing|after (?:leg day|my run|the workout)|when (?:i|we) log)\b)|\bunconscious\b(?= ?(?:on|and|right|he|she|from|in|\W*$))|\bcan't wake (?:him|her|them)(?: up)?\b|\b(?:owner|neighbou?r|coworker|colleague|stranger|man|woman|guy|lady|person|teacher|boss|passenger|runner|customer)\b (?:just |has |suddenly )?(?:collapsed|passed out|is unconscious)\b|\blost consciousness\b|\b(?:won't|can't) come (?:to|round|around)\b(?=\W*(?:$|[.!?,;]|and|he|she|after))", rf"\b{_SOMEBODY}\b[^.?!]{{0,30}} (?:won't wake(?: up)?|not waking up|isn't waking up|aren't waking up|can't be woken)\b(?! (?:before|until|for school|early|on time)\b)", r"\b(?:i |just |i've |i have |he |she |husband |wife |mom |mum |dad |son |daughter |friend |mother |father |nearly |almost )+(?:fainted|passed out|blacked out)\b(?! (?:last (?:year|month)|years?|months?|on (?:the|my) (?:couch|sofa|bed)|flyers?|candy|samples?|the (?:flyers?|candy|samples?|calendar)|my (?:calendar|schedule)|halloween|when i (?:saw|heard|read|looked|stepped on)|at (?:\d|nine|ten)|early|when i was (?:a|young|pregnant)|watching|by (?:\d|nine|ten))\b)|^(?:fainted|passed out|blacked out) (?:twice|again|in|at|this|today|just|while|and|from)\b|\b(?:keep|keeps|kept) (?:fainting|passing out|blacking out)\b", r"\bheart is (?:racing really|fluttering|skipping)\b",
    rf"\b(?:my (?:son|daughter|child|kid|baby|toddler|grandson|granddaughter)|he|she)(?: \w+){{0,2}} (?:took|ate|swallowed|got into|drank) (?:my|some|the|his|her|a few|a lot of)(?: \w+){{0,2}} {_PILLS}\b", r"\b(?:stopped taking|ran out of|run out of|haven't (?:taken|had)|out of|stop taking)(?: \w+){0,3} insulin\b", r"(?:^|\b(?:my|his|her|and|blood) )sugar (?:is |was |at |of |reading )?[4-9]\d\d\b(?! ?(?:g\b|grams|mg|calories|steps|kcal))", r"\bmeter (?:just )?(?:says|reads|shows|said|is at) (?:hi|high|lo|low|[1-4]\d|[4-9]\d\d)\b(?! (?:steps|grams|calories))|\b(?:sugar|glucose|cgm|dexcom|libre) (?:just )?(?:reads|says|is|shows|is at) (?:hi|lo)\b(?=\W*(?:$|[.!?,]| on| and))|\bat [1-4]\d (?:with|and) (?:the |an? )?(?:double )?(?:arrow|arrows)\b[^.?!]{0,20}\b(?:down|dropping)\b|\binsulin pump\b[^.?!]{0,40}\b(?:too much|malfunction\w*|stuck)\b",
    r"\b(?:arm|leg|face|side|hand|he|she|i)(?: \w+)? (?:went|gone|is|feels|side) (?:completely |totally |suddenly )?(?:numb|weak)\b[^.?!]*\b(?:can't (?:speak|lift my|move|talk|feel)|face|speak|move (?:my|his|her)|one side)\b(?![^.?!]*\b(?:push-?up|dentist|novocaine|say no|workout|slept on)\b)|\b(?:half|one side|(?:the )?(?:left|right) side)(?: of)? (?:my|his|her|the) (?:face|body)\b[^.?!]{0,20}\b(?:numb|droop\w*|dropped|fallen|weak|paraly\w*|tingl\w*)\b|\b(?:my|his|her) face (?:went|is|has gone|suddenly went) (?:suddenly |completely )?(?:numb|paraly\w+)\b(?![^.?!]*\b(?:dentist|novocaine|cold|mask|botox|cream)\b)|\bcan't feel (?:my|his|her) (?:left |right |whole )(?:face|arm|leg|side|body|hand)\b|\bhalf (?:of )?(?:my|his|her) face\b[^.?!]{0,20}\b(?:sliding|dropping|falling|melting)\b|\bwent blind (?:in|on)\b|\b(?:suddenly )?blind in (?:one|my|his|her)\b|\bcan't feel (?:the )?(?:left|right|one)(?: side of)? ?(?:my|his|her)? ?(?:face|arm|leg|side|body)\b|\b(?:arm|leg) suddenly (?:went|got|feels|is) (?:weak|numb)\b|\b(?:arm|leg|side) (?:has |is )?(?:gone|went|is) (?:weak|numb|limp)\b(?=[^.?!]*\b(?:sudden\w*|speech|slur\w*|talk\w*|confus\w*|droop\w*|vision|nonsense)\b)|\b(?:speech|talk\w*|nonsense|slur\w*)\b[^.?!]*\b(?:arm|leg|side|face)\b[^.?!]{0,20}\b(?:weak|numb|limp|droop\w*)\b|\bspeech (?:is |was |got |has |suddenly |'s )*slurr\w+|\b(?:suddenly )?can't (?:speak|talk|find (?:my )?words|get (?:my )?words out)(?: properly| right)?\b(?=[^.?!]*\b(?:sudden\w*|numb|face|arm|weak|slur\w*|dizzy|confus\w*)\b)|\bsuddenly can't (?:speak|talk|see|walk|move)\b|\b(?:lost|losing|no) (?:my |his |her )?(?:vision|sight)\b(?=[^.?!]*\b(?:eye|sudden\w*)\b)|\bcan't see (?:out of|from|in) (?:one|my (?:left|right)|either|his|her) ?(?:left |right )?eye\b|\b(?:left|right|one) side (?:went|is|feels) (?:numb|weak)\b", r"\bclutching (?:his|her|their|my) chest\b", r"\bchest feels like\b", r"\bcrushing pain\b", r"\b(?:baby|son|daughter|kid|child|toddler|husband|wife|mom|mum|dad|he|she|he's|she's|i'm|they|lips?|face|fingers?)(?: \w+)? (?:is |are |'s |has |have |look |looks |going )?(?:turning|turned|going|gone|went|look|looks|are|is) blue\b(?![^.?!]*\b(?:bowl|dress|shirt|eyes|jeans|berries|berry|teeth|tongue|paint\w*|hair)\b)|\blips? (?:look|are|turning|turned) blue\b", r"\binhaler (?:isn't|is not|not) working\b",
    r"\bswallow(?:ed|ing)?\b[^.?!]{0,30}\b(?:battery|batteries|magnets?|glass(?! of)|coin|bleach|detergent|poison|something sharp)\b", r"\b(?:swallowed|ate|took) (?:a |the )?(?:bunch|handful|bottle|lot|load) of (?:\w+ )?(?:pills|tablets)\b", r"\b(?:not|isn't|won't) (?:responding|respond|breathing right|breathing properly)\b", r"\bhives and wheez\w*|\bwheezing\b(?=[^.?!]*\b(?:hives|swell\w*|can't|ate|allerg\w*)\b)|\bhives\b[^.?!]*\bwheez\w*", r"\b(?:mouth|throat)(?: and \w+)? (?:is|are) burning\b(?=.*\b(?:drank|swallowed|bottle|ate)\b)(?!.*\b(?:habanero|peppers?|spicy|hot sauce|jalape\w+|chil\w+|wasabi|curry|salsa)\b)|\b(?:drank|swallowed)\b.*\b(?:mouth|throat)(?: and \w+)? (?:is|are) burning\b",
    r"\bblack and tarry\b|\btarry stool\b", r"\bpulse is (?:super |really |very )?(?:slow|fast|weak)\b", r"\bheart (?:is )?(?:going crazy|won't slow down)\b", r"\bwoke up on the (?:kitchen |bathroom |bedroom )?floor\b", r"\b(?:hit|cracked|banged|smashed|bumped) (?:my|his|her|their) head\b(?=.*\b(?:pupils?|being sick|blurry|dizzy|passed out|vomit\w*|throwing up|threw up|confused|drowsy|sleepy|seeing double|blood thinners?|bleeding|won't)\b)|\bblood thinners?\b(?=.*\bhit my head\b)", r"\b(?:fallen|fell)\b[^.?!]{0,30}\bcan't get up\b|\bhip (?:is )?broken\b|\b(?:fell|fallen)\b[^.?!]*\bbroke (?:her|his|my) hip\b", r"\b(?:my |the )?throat (?:is )?closing\b", r"\bwrong (?:insulin|dose|pills?|meds|medication|tablets)\b(?=.*\b(?:gave|took|swallowed|sweating|shaking|dizzy|drowsy|help)\b)",
    r"\b(?:going to|about to|feel like i(?:'m going to| might)) black out\b(?! (?:the|my) )|\b(?:fighting|struggling|gasping) for (?:air|breath)\b|\bcan't get (?:any |enough )?air\b|\bcan't find (?:her|his|my|the) epi ?pen\b|\bcan't get (?:him|her|them|my \w+) to wake(?: up)?\b|\belephant (?:is )?(?:sitting|standing) on (?:me|him|her)\b|\b(?:coughed|coughing|cough) up blood\b|\b(?:stopped sweating|heat ?stroke)\b|\bnot making (?:any )?sense\b(?=[^.?!]*\b(?:he|she|dad|mom|husband|wife)\b|.*\b(?:hot|sweat\w*|fell|fever|sugar|diabetic)\b)|\b(?:snake|rattlesnake|copperhead|viper) (?:bit|bite)\b|\bbitten by a (?:snake|rattlesnake|black widow)\b|\bskin(?:'s| is) (?:coming|peeling|falling) off\b(?=.*\b(?:oil|burn\w*|fire|boiling|scald\w*)\b)|\btongue (?:is |'s )?(?:getting|going|looks) (?:big|bigger|fat|thick|huge)\b", r"\b(?:going to|feel like i'm going to|about to) pass out\b(?! (?:early|on (?:the|my)|from (?:this|the|all|too much|eating|that) (?:turkey|food|carbs|meal|dinner|pasta)|after (?:this|that|dinner)|flyers?|tonight|at)\b)(?<!so full i'm about to pass out)(?<!so full i'm going to pass out)", r"\btook (?:my |some of my |his |her )?\w+'?s? (?:heart |blood pressure |pain )?(?:pills?|meds|medication|tablets) (?:by mistake|by accident|instead|thinking (?:they|it) (?:were|was))\b", r"\btoo many of my\b[^.?!]{0,15}\b(?:pills?|meds|tablets)\b", r"\bfell\b[^.?!]{0,30}\b(?:not responding|bleeding from|unconscious|won't wake)\b", r"\bstiff neck\b[^.?!]*\b(?:fever|confused)\b",
    r"\bbreathing (?:looks|is|seems|sounds) (?:weird|funny|wrong|odd|off|shallow|laboured|labored|noisy)\b", r"\b(?:baby|toddler|child|son|daughter|he|she|he's|she's)\b[^.?!]{0,15}\b(?:floppy|limp|unresponsive)\b", r"\bthroat (?:feels|seems|felt) (?:like it(?:'s| is) )?(?:closing|tightening|swelling)\b", r"\bblood\b(?! (?:sugar|pressure|test|type|work|results?|oranges?)\b)[^.?!]{0,40}\bfeel(?:ing)? (?:faint|dizzy|weak)\b",
    r"\bcan't lift my (?:left |right )?(?:arm|leg)\b(?=[^.?!]*\b(?:slur\w*|numb|face|suddenly|speech)\b)|\b(?:i'm|he's|she's|is) slurring\b", r"\bcrushing (?:feeling|pain|pressure|sensation)\b", r"\bblack stools?\b", r"\bsoaking through\b(?=[^.?!]*\b(?:faint|dizzy|baby|pads?|blood)\b)", r"\bconfused and (?:shaking|sweating|drowsy)\b|\bdoesn't know where (?:he|she|they) (?:is|are)\b",
    r"\bcan't (?:properly )?wake my \w+(?: up)?\b", r"\b(?:face|mouth|smile)\b[^.?!]{0,15}\b(?:droop\w*|lopsided)\b|\btalking (?:gibberish|nonsense)\b(?=[^.?!]*\b(?:arm|face|weak|sudden\w*|confus\w*|droop\w*|collapsed|slur\w*)\b)|\b(?:mum|mom|dad|mother|father|husband|wife|gran\w*|he|she)(?:'s| is| has been| started)? talking gibberish\b(?![^.?!]*\b(?:cute|lol|toddler|baby)\b)|\bsmile is wonky\b", r"\bhaving a fit\b(?! (?:of|about|over|because|at|when)\b)", r"\bchest (?:has gone|feels|felt|went|gone) (?:\w+ )?(?:tight|heavy)\b", r"\bleft arm (?:feels|is|has gone|went) (?:\w+ )?(?:heavy|numb|weak|tingl\w+)\b", r"\b(?:keep|kept|been) (?:blacking|passing) out\b",
    r"\bnearly (?:passed|blacked) out\b(?![^.?!]*\b(?:class|workout|gym|lol|laughing)\b)", r"\bgr[ea]y and sweat\w*\b", r"\brash\b[^.?!]{0,40}\b(?:doesn't|won't|didn't|not) fade\b", r"\bheart (?:is |'s )?(?:racing|pounding|skipping|fluttering)\b(?=[^.?!]*\b(?:won't settle|won't stop|sweaty|faint|dizzy)\b)", r"\b(?:leg|arm|side|hand) won't move\b", r"\b(?:got |was |been |bee |wasp |hornet )(?:\w+ )?(?:stung|sting)\b(?=.*\b(?:throat|breathe?|swell\w*|tongue|lips)\b)", r"\b(?:allerg\w*|peanuts?|shellfish|shrimp|bee|wasp|sting|stung|hives)\b[^.?!]*\bthroat\b[^.?!]{0,20}\b(?:tight\w*|itchy|swell\w*|clos\w*)\b|\bthroat(?:'s| is)? closing\b|\basthma attack\b(?=[^.?!]*\b(?:now|won't|can't|inhaler|bad|breath\w*|help)\b)|\bhaving an asthma attack\b|\bwheez\w*[^.?!]*\binhaler\b|\binhaler (?:is |isn't |not |has )?(?:empty|run out|working|gone|lost)\b(?=.*\b(?:wheez\w*|breath\w*|asthma|attack)\b)|\b(?:breath\w*|asthma|wheez\w*)\b[^.?!]*\binhaler (?:is |isn't |not )?(?:empty|run out|working|gone)\b", r"\bbleeding from (?:the|his|her|their|my) (?:head|ears?)\b",
    r"\b(?:meds?|pills?|tablets?|medication|medicine)\b[^.?!]{0,30}\b(?:took|had|taken) (?:way |far )?too (?:much|many)\b", r"\b(?:vomited|threw up|brought up) blood\b",
    r"\b(?:call|need|send|get)(?: me)? (?:an )?(?:ambulance|911|999|112|paramedics?)\b(?! (?:test|bill|driver)\b)", r"\b(?:need|have|going|should (?:i|we)) (?:to )?(?:go |get )?to (?:the )?(?:er|emergency room|a&e|hospital) (?:right now|now|immediately|asap)\b", r"\b(?:medical emergency|worst headache of my (?:whole |entire )?life)\b(?! (?:kit|fund|contact)\b)", r"\bpregnan\w*[^.?!]{0,30}\bbleeding\b|\bbleeding\b[^.?!]{0,30}\bpregnan\w*", r"\bsuddenly (?:\w+ )?(?:can't see|went blind|weak on one side|numb on one side|confused)\b",
    r"\b(?:vomit(?:ing)?|throwing up|coughing up|coughing|pooping|passing) (?:\w+ )?blood\b", r"\bbleeding (?:won't stop|a lot|heavily|badly|everywhere|that won't|so much|and (?:it )?won't stop|really bad)\b|\bbleeding\b[^.?!]{0,20}\b(?:spurting|gushing|faint)\b|\bblood everywhere\b(?![^.?!]*\b(?:movie|game|show|steak|nosebleed)\b)|\b(?:so much|a lot of|too much|lots of) blood\b(?=[^.?!]*\b(?:cut|lost|losing|pregnant|vomit\w*|faint|i|he|she|from|coming)\b)|\blost (?:a lot|so much|too much|lots) (?:of )?blood\b|\bto the bone\b|\b(?:sliced|chopped|cut|ripped|tore) (?:off (?:the )?(?:tip of |end of )?(?:my|his|her) (?:finger|thumb|toe|hand)|(?:my|his|her) (?:finger|thumb|toe|hand|arm) (?:clean )?off)\b|\bsevered\b|\b(?:cut|hit|nicked) an artery\b|\bblood in (?:my|his|her|the) vomit\b|\bblood in (?:my|his|her) (?:stool|poop|urine|pee)\b(?=[^.?!]*\b(?:dizzy|faint|lots?|weak|black)\b)|\bcoffee grounds\b(?=[^.?!]*\b(?:vomit\w*|throw\w*|threw|puk\w+)\b)|\b(?:vomit\w*|throw\w* up|threw up)\b[^.?!]*\bcoffee grounds\b|\bpregnant\b[^.?!]*\b(?:blood|bleeding)\b", r"\b(?:won't|can't) stop (?:the )?bleeding\b", r"\bheavy bleeding\b", r"\b(?:spurting|gushing)\b(?=[^.?!]*\b(?:blood|cut|won't stop|hand|finger|arm|leg)\b)|\b(?:cut|blood|hand|finger|arm|leg)\b[^.?!]*\b(?:spurting|gushing)\b",
    r"\b(?:blood sugar|glucose|sugar) (?:is|was|went|dropped|has dropped|'s)(?: \w+){0,3} (?:dangerously low|crashing|so low|really low|too low|under 5\d|below 5\d)\b(?! ?%)", r"\b(?:blood sugar|blood glucose|glucose|sugar level|my sugars?|his sugars?|her sugars?|bg)\b(?:\W+(?:level|levels|reading|readings|number|meter|is|was|at|reads?|says|(?:went|dropped|fell|crashed|shot|jumped|spiked)(?: down| up)? to|has|been|of|over|above|under|below|around|about|just|now|only|like|still|the|it's|and|got|hit)){0,5}\W+(?:[1-4]\d|[4-9]\d\d)\b(?! ?(?:g\b|grams?|%|mg of|per|cal|kcal|carbs|days|points|percent|minutes|/|or|to \d|lower|higher|less|more)|\.\d)", r"\b(?:diabetic coma|insulin shock|hypoglyc(?:a)?emic (?:shock|attack))\b", r"\b(?:i'm|he's|she's|is) choking\b(?! (?:up|back|down)\b)",
)

_CHECK = _rules(
    r"\b(?:can't|don't think i can|not sure i can) (?:go on|keep going|carry on|keep doing this|do this anymore|take (?:it|this) anymore|live like this|keep living like this|bear (?:it|this) anymore|handle (?:it|life|this) anymore|fight anymore|face (?:another day|tomorrow|life))\b",
    r"\bdon't (?:\w+ )?want to (?:be here|live like this|do this anymore|keep going|go on|feel (?:anything|this) anymore|be around anymore)\b(?! for (?:long|hours)| today because| when (?:the|my|they|he|she|it)\b)", r"\bwant(?:s|ed|ing)? to (?:just )?(?:disappear|vanish|sleep forever|go to sleep (?:and (?:(?:never|not) wake(?! up (?:until|till|before|at|early)\b)(?: up)?|that(?:'s| is|'ll)?(?: be)? it\b|be done|stay asleep)|forever)|fade away|be gone|stop existing|not feel anything)\b",
    r"\b(?:life is|life's|everything is|everything's|it's all) (?:pointless|meaningless|over(?! (?:my|the|it|again|social|facebook|instagram|town|now that|your|me|for (?:the|my) (?:diet|year))\b)|too much)\b", r"\b(?:no|what's the|what is the|don't see the|not see the|see no) point (?:in|of|to) (?:anything|any of (?:it|this)|life|going on\b(?! (?:a|an|the|keto|paleo|statins?|vacation|holiday|diets?|with (?:the|my|this) (?:diet|plan)|\w+ (?:diet|medication))\b)|living\b(?! if i can't)|it all|being here|trying anymore)\b", r"\bno point anymore\b", r"\bnothing matters (?:anymore|now)\b", r"\b(?:don't|can't) see a (?:future|way forward)(?: for me)?\b", r"\bno future for me\b",
    r"\bwant (?:it|everything|this)(?: all)? to (?:end|stop|be over)\b", r"\bmake it all (?:stop|go away)\b", r"\bsleep (?:and|then) (?:never|not) wake\b", r"\b(?:i )?won't matter (?:soon|anymore)\b", r"\bgiv(?:e|en|ing)(?: |-)up (?:on )?(?:my (?:own )?life\b(?! (?:savings|insurance|style)\b)|life\b|living\b|being (?:alive|here)\b|myself\b|everything\b|it all\b|hope\b)", r"\bgave up on (?:life|living|myself|everything)\b",
    r"\bi'm (?:so )?done\W+ ?(?:with (?:everything|it all|all of (?:it|this)|this life|trying)|for good|fighting|trying|living)\b", r"\bno way out\b", r"\bwant out\b(?=.*\b(?:of (?:this|my) life|of everything|for good)\b)", r"\b(?:think|thinking|thoughts)(?: \w+){0,2} (?:about|of) (?:death|dying)\b(?! (?:from|of heart)\b)", r"\b(?:please|just|someone|somebody|god) (?:please )?kill me\b(?! (?:with|if|when|that|,))", r"\bi'm going to die\b(?! (?:if|of|from|without|unless|one day|someday|early|young)\b)", r"\bfeel(?:ing)? like dying\b(?! after\b)",
    r"\b(?:want|need) (?:the|this|my) (?:pain|suffering|hurt) to (?:stop|end|be over)\b(?![^.?!]*\b(?:knee|back|stomach|tooth|joint|muscle|period|migraine|head|leg|arm|neck|shoulder|foot|hip|surgery)\b)",
    r"\bnot (?:be|being) (?:here|around) (?:much longer|anymore)\b", r"\bnot sure (?:i'll|if i'll|i will) (?:still )?be (?:here|alive)\b|\bnot sure (?:i'll|if i'll|i will) (?:still )?be around\b(?! (?:this|next (?:week|weekend|\w+day)|for (?!long\b|christmas|it\b|my birthday|much)|at|on|to|until|later|tomorrow|tonight|when|in the (?:morning|afternoon)|\w+day)\b)", r"\bwish (?:i could|to) (?:just )?(?:disappear|vanish)\b", r"\b(?:lost all hope|no hope left|there is no hope|there's no hope)\b", r"\bnobody would notice\b(?=\W*(?:$|[.!?,])| me\b| i'm gone| if i(?: was| were|'m)? (?:gone|died|disappeared|left|stopped|vanished))", r"\bsuicid\w+ yet\b",
    r"\b(?:would|will) (?:anyone|anybody|you|the app|they|somebody|someone|people)(?: \w+){0,3} (?:notice|care|be sad|miss me|find me)\b(?=[^.?!]*\bif i (?:died|was gone|were gone|disappeared|vanished|left|wasn't|weren't|stopped (?:being|coming|logging|existing|showing)|didn't (?:exist|wake))\b|[^.?!]*\bi (?:died|was gone|disappeared)\b)", r"\bif i (?:was|were) gone\b(?! (?:for|to|on|until|from|all|a (?:week|month)|two)\b)|\bif i (?:just )?stopped being here\b|\bstopped being here one day\b|\bif i died\b(?=[^.?!]*\b(?:would|sad|care|miss|notice)\b)", r"\bhow long (?:would|until|before|till)[^.?!]{0,30}\b(?:find|found) me\b",
    r"\bso tired of (?:fighting|trying|all of it|it all|everything)\b", r"\bthis is it for me\b", r"\btell my (?:mom|mum|mother|dad|father|kids|family|wife|husband|son|daughter|sister|brother|parents) (?:that )?i love (?:her|him|them|you)\b(?! (?:every|all the time|always|before (?:school|bed)|each|daily)\b)", r"\b(?:goodnight|good night) forever\b", r"\btempted to (?:just )?stop (?:taking )?my (?:insulin|meds|medication|pills)\b",
    r"\bwhat (?:happens|would happen) if i (?:take|took|swallow|swallowed)\b[^.?!]{0,20}\b(?:the whole (?:bottle|pack|box)|all (?:of )?(?:my|the) (?:\w+ )?(?:pills?|meds|medications?|medicine|tablets|insulin)|every (?:pill|tablet|one)|a whole (?:bottle|pack|box))\b",
    r"\bhow much longer i can (?:do|take|go|keep|live|hold|stand)\b", r"\bgiv(?:e|ing) up\W+ ?on (?:everything|life|it all)\b", r"\b(?:my|the) story is over\b|\bfeels like my story\b", r"\bwon't be (?:a burden|(?:anyone's|anybody's|your|their|his|her|my family's) (?:problem|burden))\b", r"\b(?:doesn't|don't|nothing) matters? (?:to me )?anymore\b(?=.*\b(?:i|my|me)\b)|\b(?:i|my)\b.*\bdoesn't matter anymore\b",
    r"\bdon't care what happens(?: to me)?\b", r"\bdon't think i'll (?:be around\b(?! (?:for (?!long\b|christmas|it\b|my (?:next )?birthday|much|the (?:summer|end))|this (?:week|weekend|\w+day)|next (?:week|weekend|\w+day)|at\b|on\b|to\b|until|tomorrow|tonight|when)\b)|make it\b(?! (?:to|for|on|by|in (?:time|today)|today|tonight)\b(?! (?:christmas|tomorrow|morning|next year|my (?:next )?birthday|\d\d\b|the (?:end of the (?:year|week)|weekend))\b)|(?= to (?:christmas|tomorrow|morning|next year|my (?:next )?birthday)))|be here\b(?! (?:for (?!long\b|christmas|it\b|my (?:next )?birthday|much)|this (?:week|weekend|\w+day)|next (?:week|weekend|\w+day)|at\b|on\b|to\b|until|tomorrow|tonight|when)\b)|see (?:tomorrow|another|next (?:year|week|month)|christmas|my kids grow|the (?:end|new year))|be alive)\b", r"\bwon't be around for\b", r"\bhad enough of (?:this life|life|living|everything|it all)\b", r"\btired of (?:waking up\b(?! (?:at|hungry|tired|early|with|in|every night|to|sore|bloated|late|feeling)\b)|being me\b)", r"\bwhy (?:i'm|am i) (?:even |still )?alive\b", r"\bif (?:something|anything) happens to me\b", r"\bwhat (?:is|'s) the use\b(?=.*\b(?:staying|living|anymore|here)\b)",
    r"\b(?:don't|can't|couldn't) (?:really |even |just )?(?:see|imagine|picture) (?:myself|me)\b[^.?!]{0,30}\b(?:here|around|future|alive|next year|getting old(?:er)?|growing old|living(?! (?:without (?!him|her|them)|on|in|with)\b))\b", r"\bno version of (?:next year|the future|tomorrow|my life)\b", r"\b(?:doubt|not sure|don't know if|don't expect) (?:that |if )?i(?:'ll| will|'m going to) (?:still )?(?:be (?:around\b(?! (?:for|this|next|at|on|to|until|tomorrow|tonight|when)\b)|alive)|make it (?:past|that far|to (?:\d\d\b(?! ?(?:,|k|000|steps|pounds|lbs|miles|reps|minutes|%))|christmas|next year)))\b(?![^.?!]*\b(?:steps|pounds|miles|reps)\b)",
    r"\bif (?:something|anything) (?:bad )?happened to me\b(?=[^.?!]*\b(?:relieved|relief|better|fine|notice|care|easier)\b)", r"\b(?:ran|run|running) out of reasons\b|\bno (?:more )?reasons left\b", r"\bhow much longer (?:does|do|will|must) (?:this|it|i)\b(?=.*\b(?:everything|life|all of it)\b)", r"\bdon't plan on (?:getting old|growing old|being here|living)\b", r"\b(?:not sure|don't know if|don't) i? ?(?:even )?want to (?:make it|live|get) to (?:\d+(?! ?(?:pounds|lbs|kilos|kg|steps|minutes|miles|percent|%|calories|grams)\b)|thirty|forty|fifty|old age|next year|christmas)\b",
    r"\bdark thoughts\b", r"\bthose thoughts (?:again|are back|came back)\b", r"\b(?:everyone|everybody|they|family|kids|wife|husband|world|life)\b[^.?!]{0,30}\b(?:carry(?:ing)? on|start(?:ing)? over|move on|be fine|manage|go(?:ing)? on|cope) (?:fine |better |just fine )?without me\b(?! (?:at|in|on|for|while|until|this|today)\b)", r"\bonly one way out\b", r"\b(?:no|see any|there any|isn't any) other way (?:out|to make (?:this|it) stop)\b",
    r"\bmy time (?:here )?is (?:done|up|over|nearly (?:up|over|done))\b(?! (?:on|for|with|in|at)\b)", r"\b(?:tired|had enough) of (?:this|the) world\b|\btired of this life\b", r"\bjust stop being here\b", r"\bwon't be needing\b[^.?!]{0,50}\b(?:after (?:today|tonight)|where i'm going|anymore(?<!jeans anymore)(?<!pants anymore)(?<!clothes anymore)(?<!inhaler anymore)(?<!insulin anymore)(?<!statins anymore))\b", r"\bwon't (?:be )?(?:troubl|bother)\w* (?:you|anyone|anybody|them|people) (?:again|anymore|any ?longer|much longer)\b(?! (?:with|about|today)\b)|\bput up with me much longer\b",
    r"\bthe pain has won\b|\bdon't (?:think i )?want to keep (?:fighting|living)\b", r"\b(?:you|they|he|she|everyone|nobody|no one|people|my \w+|you guys)(?:'ll)? (?:won't|will never|never|never going to|are never going to) (?:ever )?see me again\b", r"\bdon't (?:let|leave) me (?:be )?(?:alone|on my own) (?:tonight|right now)\b", r"\bmy (?:own )?funeral\b", r"\bdon't want (?:(?:any )?more|another|anymore) (?:birthdays?|years?|christmas(?:es)?)\b(?! (?:like|with|of|where|in which|cake)\b)|\bif i (?:just )?(?:vanish|disappear)(?:ed)?\b|\bnot meant for this world\b|\b(?:quieter|easier|simpler|cheaper|better|nicer) for (?:them|everyone|everybody|him|her|you|my \w+) if i (?:wasn't|weren't|didn't)(?=\W*(?:$|[.!?,])| (?:here|around|alive|exist|in the picture|born|there|in it|wake))", r"\bdead\b[^.?!]*\bmake it official\b", r"\b(?:be )?(?:free|rid) of me\b", r"\bdon't want to be (?:a person|human) anymore\b", r"\b(?:so|too|this|very) close to the edge\b(?! of)",
    r"\bliving (?:is|feels) (?:\w+ )?(?:painful|unbearable)\b|\bliving hurts\b", r"\bready to (?:go )?be with (?:my \w+|him|her|them|god|the lord)\b(?=.*\b(?:no sense|no point|dragging|passed|died|gone|heaven|tired(?! of (?:travel\w*|work\w*|the)))\b)", r"\bkeeps? saying (?:she|he|they) wants? to (?:go )?(?:and )?be with (?:mum|mom|dad|gran\w*|nan|god|jesus|my \w+)\b", r"\bsaying goodbye to (?:people|everyone|everybody)\b(?![^.?!]*\b(?:moving|job|school|vacation|leaving town|retire\w*|airport)\b)",
    r"\baffairs in order\b", r"\bkeeps? saying (?:she|he|they) wants? to be with (?:him|her|them)\b", r"(?<!can't wait to )\bbe with (?:him|her|them|my (?:wife|husband|mom|mum|dad|son|daughter|baby)) again\b(?=[^.?!]*\b(?:want|just|soon|heaven)\b)",
)

_HEAVY = _rules(
    r"\b(?:i )?(?:hate|loathe|despise) (?:myself|my life|being me)\b", r"\b(?:feel|feeling|i'm|am|such)(?: \w+){0,2} (?:worthless|useless|a burden|a failure|unlovable|a waste of space|broken inside)\b", r"\bcan't cope\b", r"\b(?:i'm )?(?:falling apart|breaking down|having a breakdown|losing it|at (?:rock bottom|breaking point|my breaking point|the end of my rope))\b",
    r"\bcan't stop crying\b", r"\b(?:crying|cry) (?:all|every)(?: single)? (?:day|night|the time)\b", r"\bpanic attacks?\b", r"\b(?:numb|empty|dead) inside\b", r"\b(?:feel|feeling|been|so) (?:so )?(?:numb|empty)\b", r"\bnothing brings me (?:joy|happiness)\b", r"\bcan't get out of bed\b", r"\b(?:no ?body|no one|no-one) (?:cares|loves me|likes me|would care|understands)\b", r"\b(?:completely|totally|utterly|so) (?:alone|hopeless|desperate)\b", r"\bi(?:'m| feel)(?: \w+)? (?:hopeless|desperate|trapped)\b", r"\bwhat(?:'s| is) the point(?:\W*$|[.?!,]| (?:anymore|in|of) ?(?:anything|it all|any of (?:it|this)|trying|living|life|going on|being here|me\b|myself|looking after))", r"\beverything is falling apart\b",
    r"\b(?:make|making|made) myself (?:throw up|vomit|puke|sick|be sick)\b", r"\bpurg(?:e|ed|ing)\b(?! (?:the )?(?:fridge|pantry|kitchen|cupboards?|closet|inbox|old))", r"\bstarv(?:e|ed|ing) (?:myself|for days)\b", r"\bdon't deserve (?:to eat|food|to be happy|love)\b", r"\blaxatives? (?:to (?:lose|get|be)|after i eat|so i don't)\b", r"\b(?:skip|skipping) food for days\b", r"\bhide that i'm not eating\b|\bhid(?:e|ing) (?:the )?(?:wrappers|food|that i)\b",
    r"\b(?:anorexi\w+|bulimi\w+|eating disorder|pro[- ]ana|thinspo)\b", r"\b(?:can't stop|keep) bing(?:e|e?ing)\b|\bbinge (?:till|until|and|then)\b", r"\bcan't let it stay in me\b", r"\bhaven't eaten in (?:\d+|two|three|four|five|six|several) days\b",
    r"\bhopeless\b", r"\b(?:i )?(?:give|giving) up\b(?=\W|$)", r"\b(?:i'm|feel(?:ing)?|been|so|really|very|severely)(?: \w+)? depressed\b", r"\b(?:my|this|the) depression\b",
    r"\b(?:feel|feeling|felt) (?:\w+ )?(?:hollow|broken|shattered inside)\b|\bin bits\b|\bin pieces\b(?=[^.?!]*\b(?:i|i'm)\b)|\bcan't stop (?:shaking|sobbing)\b|\bwreck me\b|\b(?:cry|crying|cried|sobbed) in (?:the|my) (?:car|bathroom|toilet|shower)\b", r"\bsick on purpose\b|\bbinged again\b|\bhate my body\b|\bweigh(?:ing)? myself (?:over and over|constantly|\d+ times)\b|\bonly thing i (?:feel in|can) control\b|\bonly thing i feel in control of\b",
    r"\bivf\b[^.?!]{0,20}\bfail\w*\b|\bfailed\b[^.?!]{0,20}\bivf\b", r"\b(?:been|is|was) cheating\b(?! (?:on|with) (?:my|the|this) (?:diet|plan|meal))", r"\bhasn't spoken to me\b|\bdoesn't know who i am\b|\bhaven't (?:washed|left the bed|left the house)\b", r"\b(?:only|just|always) in the way\b", r"\bdepression'?s? (?:is |'s )?(?:bad|back|heavy)\b", r"\bput (?:my|our|the) (?:dog|cat|pet) to sleep\b",
    r"\bmiscarr\w+\b", r"\b(?:put|had to put) (?:our|my|the) (?:dog|cat|pet) down\b", r"\bwould have been \d+ today\b", r"\bcan't (?:function|look in (?:a|the) mirror)\b", r"\blost the baby\b", r"\bnothing left of me\b", r"\beat in secret\b|\beat it out of the (?:trash|bin)\b", r"\b(?:come|go|went) home and cry\b", r"\bdrinking (?:every|all) (?:night|day)\b|\bfeel(?:ing)? broken\b", r"\bi miss (?:my (?:wife|husband|mom|mum|dad|mother|father|son|daughter|brother|sister|grandma|grandpa|partner)|him|her|them) so much\b",
)

_FEELING_WORDS = {
    "anxious": r"(?:anxious|anxiety|dread|jumpy|shaken|on tenterhooks|worried|worrying|nervous|panicky|panicking|scared|afraid|frightened|on edge|uneasy|dreading)",
    "sad": r"(?:sad|down|low|flat|weepy|guilty|jealous|fat|awful|hurt|rubbish|unhappy|miserable|heartbroken|lonely|tearful|blue|gutted|upset|grieving|devastated|crying|cried|gloomy|homesick|bummed|blah|insecure|ashamed|in a funk)",
    "frustrated": r"(?:frustrated|frustrating|grumpy|cross|snappy|angry|annoyed|fed up|irritated|discouraged|disappointed|furious|stuck|giving up|done with this)",
    "stressed": r"(?:stressed|stress(?:ful)?|overwhelmed|burn(?:ed|t) out|burnout|exhausted|worn out|under (?:so much |a lot of )?pressure|swamped|frazzled)",
}
_ADVERB = r"(?:so|really|very|a bit|a little|quite|pretty|just|feeling|been|bit|too|super|extremely|kind of|kinda|sort of|all|always|getting|lot of|some|such|completely|totally|like)"
_FEELING = {name: re.compile(rf"(?:\b(?:i'm|i feel|i've been|i've felt|i was|feel|feeling|been|makes? me|made me|i get|i'm getting|i keep|so|really|very|this is|it's|having|just|i|always)(?: {_ADVERB})*) {words}\b|^(?:{_ADVERB} )*{words}\b")
            for name, words in _FEELING_WORDS.items()}
_FEELING["anxious"] = re.compile(_FEELING["anxious"].pattern + r"|\b(?:sunday|monday)(?: night)? dread\b|\bmind (?:is )?racing\b|\bcan't sleep\b")
_FEELING["sad"] = re.compile(_FEELING["sad"].pattern + r"|\bgutted\b(?! (?:fish|and|the|kitchen|house|chicken)\b)|\bhad a row\b|\bhate how i look\b|\bit stung\b|\bin a funk\b|\bhad a fight\b|\b(?:breaking up|broke up|ending things) with\b")
_FEELING["frustrated"] = re.compile(_FEELING["frustrated"].pattern + r"|\bneeded to vent\b|\bdriving me (?:insane|crazy|nuts)\b|\bgiv(?:e|ing) up on (?:this|the|my) (?:diet|plan|program)\b|\bnothing works\b")
_FEELING["stressed"] = re.compile(_FEELING["stressed"].pattern + r"|\bstressing me out\b|\b(?:doing|does|done) my head in\b|\bup the wall\b|\bnightmare (?:this|at|of a) \w+\b|\bis a nightmare\b")
_NOT_FEELING = re.compile(r"\b(?:not|never|don't feel|no longer|isn't|wasn't|less)(?: (?:so|that|too|really|very|feeling|as))* (?:sad|down|low|depressed|anxious|worried|stressed|frustrated|angry|upset|lonely|alone|overwhelmed|unhappy|scared|nervous)\b")
_DOWN_NOT_SAD = re.compile(r"\b(?:get|getting|got|go|going|went|write|note|calm|slow|cut|cutting|keep(?:ing)?|weight|number|came|come|bring(?:ing)?|is|settle|break|track|brought|numbers?|coming) down\b|\bdown (?:\d+|a (?:few|couple|bit|size|lot)|some|to|by|from|with|for|two|three|four|five|ten)\b|\blow on\b|\b(?:low|lower)[- ](?:carb|fat|sugar|glycemic|calorie|sodium|energy|gi)\b")

# ---- who, and when -------------------------------------------------------------------------

_PERSON = (r"(?:he|he's|he'll|she|she's|she'll|they|they're|him|her|them|his|their|himself|herself|themselves?|someone|somebody|anyone|people|person|everyone|friends?|sister|brother|mom|mum|mother|mama|dad|father|papa|parents?|husband|wife|partner|boyfriend|girlfriend|ex|son|daughter|"
           r"child|children|kids?|baby|toddler|cousin|aunt|uncle|grand\w+|gran(?:ny|s)?|nan|niece|nephew|roommate|flatmates?|housemate|mate|bloke|coworker|colleague|neighbou?rs?|boss|teacher|students?|clients?|patients?|celebrity|singer|actor|actress|character|teenager|teen|girl|boy|guy|woman|man|lady|step\w+)")
_WHO = re.compile(rf"\b(?:(?P<third>(?:my |a |the |our |his |her )?(?:best |old |close |own |little |older |younger |teenage )?{_PERSON})|(?P<first>i|i'm|i've|i'd|i'll|me|mine|myself))\b")
_THEMSELVES = r"(?:him|her|them)sel(?:f|ves)"
_OTHER_RISK = _rules(
    rf"\b(?:{_PERSON})(?:'s|s)?\b(?:(?!\b(?:i(?:'m|'ve|'ll|'d)?|{_PERSON})\b)[^.?!;]){{0,70}}?\b(?:suicidal|suicide|self-harm\w*|(?:kill|hurt|harm|cutt?|hang|shoot|off|starv|drown|poison|burn|scratch|hit|punish|bit|bang|topp?)(?:ing|ed|s|e|es)? {_THEMSELVES}|doing (?:it|that|this) to {_THEMSELVES}|won't be (?:alive|here) (?:tomorrow|tonight|by)|until (?:he|she|they) (?:dies?|is dead)|swallowed (?:his|her|their|a bunch of|all (?:his|her|their)) (?:pills|meds|tablets)|on purpose and (?:he|she|they)|"
    r"end(?:ing)? (?:his|her|their) (?:own )?(?:life|lives)|take (?:his|her|their) (?:own )?life|took (?:his|her|their) (?:own )?life|wants? to (?:die|disappear|be dead|not be here|be with (?:him|her|them)(?=\W*(?:$|[.!?,]|again|in heaven|so)))|wanted to die|doesn't want to (?:live|be alive|be here)|better off dead|ending it (?:tonight|now|all|today)|"
    r"(?:texted|text|posted|wrote|left|sent|(?:called|rang|phoned|messaged)(?: me)? to say)(?: \w+){0,3} (?:goodbye(?! at)|a suicide note)|said(?: \w+){0,3} goodbye(?= (?:to (?:everyone|me and|us all|the kids)|forever|and (?:hung|left|turned|won't|that|now))|\W*(?:$|[.!?,])(?=.*\b(?:won't answer|phone|worried|gone|pills|note|not answering)\b))|finish(?:ing)? it (?:tonight|now|today|all)(?![^.?!]*\b(?:leftovers?|homework|project|puzzle|game|food|pizza|cake|book|season|series|report|meal)\b)|(?<!detox and )(?<!diet and )(?<!challenge and )(?<!fast and )(?<!course and )it ends (?:today|tonight|now)|locked (?:the|her|his|their) \w+ and said (?:she|he|they) can't|(?:marks|cuts|scars|burns) on (?:his|her|their) (?:arms?|legs?|wrists?|thighs?)|won't need (?:it|them)\b(?=.*\bgiv(?:ing|en|e) (?:away|his|her|their))|letter on (?:his|her|their) bed|last night alive|locked (?:him|her|them)sel\w+ in|(?:says?|said|saying) (?:he's|she's|they're) a burden|giving away (?:all )?(?:his|her|their) (?:things|stuff|belongings|possessions|everything|\w+ (?:things|stuff))|giving away (?:his|her|their) \w+\b(?=.*\b(?:calling everyone|saying goodbye|say (?:he|she|they) loves?|goodbye|won't need)\b)|"
    r"thinks about (?:crashing|jumping|dying|ending)|crash(?:ing)? (?:the|his|her) car on purpose|texted me (?:i'm )?sorry(?: (?:mom|mum|dad|mama|daddy|sis|bro|babe|everyone|for everything|for being \w+))?(?=\W*(?:$|[.!?]|and\b|i love|goodbye))|nothing to live for|won't need (?:him|her|them) anymore|cuts on (?:his|her|their) arms)\b"
    r"|\b(?:razor blades?|blades?)\b[^.?!]{0,40}\b(?:blood\w*)\b[^.?!]{0,40}\b(?:my|his|her|their)\b")
_OTHER_RISK += _rules(
    rf"\b(?:{_PERSON})(?:'s)?\b(?:(?!\b(?:i(?:'m|'ve|'ll|'d)?|{_PERSON})\b)[^.?!;]){{0,50}}?\b(?:is|has been|'s|been|started|keeps?|kept|was|caught) cutting(?: (?:again|{_THEMSELVES}))?(?=\W*(?:$|[.!?,;]|(?:again|and|because|at school|in (?:the|his|her|their)|on (?:his|her|their))\b))",
    rf"\b(?:{_PERSON})(?:'s)?\b(?:(?!\bi(?:'m|'ve|'ll|'d)?\b)[^.?!;]){{0,60}}?\b(?:wish(?:es|ed)? (?:he|she|they) (?:was|were|had|could) (?:dead|never|just|died|not|die)|(?:better off|happier|easier) without (?:him|her|them)\b|(?:nobody|no one|no-one) would (?:even )?(?:miss|notice|care)(?: (?:if )?(?:him|her|them|he|she|they))?|going to (?:jump|do it|end it|hang|shoot|overdose|kill (?:him|her|them)sel\w+)|use it on (?:him|her|them)sel\w+|plan to (?:end|kill|die|do it)|take (?:them all|all (?:of )?(?:her|his|their|the) (?:pills|meds|tablets|medication))|tired of (?:living|being alive)|no reason to live|can't go on|doesn't want to be (?:here|alive)|talk(?:ing|s|ed)? about (?:suicide|dying|killing (?:him|her|them)sel\w+|ending it)|tried to (?:kill (?:him|her|them)sel\w+|end (?:his|her|their) life|overdose|hang)|threatening (?:suicide|to (?:kill|hurt|jump))|self-harm\w*)\b",
    rf"\b(?:he's|she's|they're|he is|she is|my \w+ is|friend is) (?:up )?(?:on|at|standing on|sitting on|over) (?:a |the |top of (?:a |the )?|the edge of (?:a |the )?)?(?:bridge|roof|ledge|overpass|tracks|cliff)\b(?![^.?!]*\b(?:fixing|repair\w*|clean\w*|working|walk\w*|photo\w*|view|run\w*|gutters?|shingles|solar)\b)",
    rf"\b(?:he|she|he's|she's|boyfriend|girlfriend|husband|wife|father|mother|dad|mom|son|brother|neighbou?r|ex)(?: is|'s|s)? (?:beating|hitting|choking|strangling|attacking|stabbing|hurting) (?:her|him|them|(?:her|his|their|the) (?:mum|mom|mother|sister|brother|kids?|wife|girlfriend|son|daughter)|my (?:mother|mom|mum|sister|brother|dad|father|daughter|son|kids?))\b(?! at)|\b(?:he|she|he's|she's|\w+)(?:'s| has| is|'s got| has got)? (?:got )?(?:a )?(?:knife|gun)\b(?=[^.?!]*\b(?:won't let|near (?:him|her)|locked|barn|shut in|on the phone|threaten\w*|screaming)\b)|\bwith a (?:gun|knife) and (?:he |she )?won't\b|\bsaying (?:he'll|she'll|they'll|he's going to|she's going to) do it\b|\bjust (?:strangled|stabbed|shot|choked|attacked|beat) (?:her|him|my (?:mom|mum|mother|sister|brother|friend|neighbou?r|daughter|son))\b|\bso (?:she|he|they) can die\b|\bgun\b[^.?!]{0,20}\b(?:on|in|to) (?:his|her|their) (?:lap|hand|mouth|head)\b|\bwrong side of the (?:railing|rail|fence|barrier)\b|\b(?:fresh |new )?(?:cuts|burns|marks|scars) (?:all over|all up|all down|on|up|down) (?:his|her|their) (?:arms?|legs?|thighs?|wrists?|stomach)\b(?![^.?!]*\b(?:cat|kitten|dog|bush|thorns?|fence)\b)", rf"\bsuicide note\b(?=[^.?!]*\b(?:my |his |her |their )(?:\w+ )?(?:{_PERSON})'?s? (?:room|bag|desk|drawer|phone|pocket|backpack|car|bed)\b)", rf"\b(?:gun|knife|rope|pills|razor)\b[^.?!]{{0,30}}\b(?:he|she|they)(?:'s|'re| is| are)? (?:says?|said|going|will|threaten\w*|wants?)\b",
)
_READING = re.compile(r"\bi(?:'ve| just|'m|'m just|'ve just)? (?:read|reading|saw|watched|watching|heard|hearing|learned|learning|studied|studying|researching|writing|wrote) (?:(?!\b(?:and|but|so|because)\b)[^.?!,;]){0,60}$")
_PAST = re.compile(r"\b(?:old (?:self-harm|scars?|cuts)|used to|years? ago|months? ago|(?:years?|months?) since|in the past|when i was (?:(?:a |an |in |at |just |only |about |still |back )*(?:teen\w*|kid|child|little|young\w*|small|student|girl|boy|school|college|high school|middle school|university|my (?:teens|twenties)|\d{1,2}|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|pregnant|married))|back (?:in|then)|as a (?:teen\w*|kid|child)|last year|a long time ago|growing up|years back|decades? ago|in (?:19|20)\d\d|haven't (?!(?:felt|been|wanted to die|hurt myself|cut myself|cut|hurt) (?:this|so|as|that)\b)(?:[\w-]+ ){0,3}(?:in|for) (?:\w+ )?(?:years?|months?)|not anymore|once at \d\d|(?:back )?in (?:high school|middle school|elementary school|primary school|secondary school|college|school|my (?:teens|twenties)|his teens|her teens)|long before|long ago|before (?:we met|i knew|i met|my time)|in (?:my|his|her) (?:[2-6]0s|teens|twenties|thirties)|(?:once|back)\b[^.?!]{0,20}\b(?:19|20)\d\d|clean ever since|before i was born|i recovered|in recovery|survivor of|survived|(?:years?|months?|weeks?|days) (?:clean|free|sober)|clean (?:from|of|for))\b")
# Back, whenever it began: nothing in the message is only the past.
_BACK = re.compile(r"\b(?:lately|recently|(?<!good )(?<!fine )(?<!better )(?<!great )(?<!well )(?<!happy )these days|feel it coming|getting worse|relaps\w+|(?:doing|happening|started|thinking about|feeling) (?:it|this|that|like this|that way|this way) again|(?:it|they|that|thoughts?|urges?|feelings?|depression|everything) (?:has |have |just |all |is |are |keeps? |keep )*(?:came|come|comes|coming) ?back|(?:it's|they're|thoughts are|urges are|feelings are|it is) back|"
                   r"ever since (?:he|she|they|we|my|the|it|i lost)|since (?:last (?:week|month|year|spring|summer|autumn|fall|winter|christmas)|he|she|they|we|it happened|my (?!last (?:attempt|relapse|cut)|recovery)\w+|the))\b")
# Whatever it began with, it is not over.
_STILL = re.compile(r"\b(?:i wish (?:it|i|they) (?:had|'d|hadn't|had not|would have)(?: (?:worked|succeeded|died|survived|finished|not|been|found|made it))*|i wish (?:my|the) (?:last |first )?attempt had|wish i(?:'d| had) (?:died|succeeded|finished it|not (?:survived|woken up|made it|been found))|regret(?:ting|ted)? (?:surviving|living|being alive|waking up|not)|"
                    r"(?:ready|going|want|planning|plan|tempted|thinking|about) (?:to|of|about) (?:try|trying|do it|doing it|attempt|attempting|another) ?(?:again|another|attempt)?|try(?:ing)? again|another (?:attempt|try|go)|next (?:attempt|time i)|never (?:really )?(?:went away|stopped|left|got better)|nothing(?:'s| has) changed|(?:those|the|these) (?:days|thoughts|feelings|urges) (?:are|is|have|came|come|keep) ?(?:back|returning|coming back)?|"
                    r"happening (?:all over|again)|all over again|now i (?:do|am|'m (?:ready|suicidal)|have (?:the|a) (?:nerve|plan|pills|gun)|want to (?:die|do it|end it|try|kill))\b|and (?:last|this) (?:week|night|month|morning)|slipped (?:last|this|yesterday|today|tonight|and|up)|should(?:'ve| have) (?:killed|ended|died|done it|finished)|broke my (?:streak|promise)|started again|(?<!can )(?<!should )(?<!could )(?<!do )i still (?:do|am|want to|feel|think|have (?:the )?(?:thoughts|urges)))\b")
# The same, in the same sentence: "and I'm thinking about it again".
_AGAIN = re.compile(r"\b(?:it|that|this way|like this|them|the same|feel|feeling|want to|thinking|thoughts?|urges?|doing|did it|cutting|cut|hurt\w*|harm\w*|self-harm\w*|attempted|tried|kill\w*|started|tempted|suicid\w*)\b[^.?!;]{0,30}\bagain\b|\bi(?:'m| do|'ve)? still (?:feel|think|want|do|cut|hurt|am|have|get)\b|\bstill (?:feeling|thinking|wanting|cutting|hurting|suicidal|doing it)\b|\bagain\b[^.?!;]{0,30}\b(?:it|feel|feeling|want to|think\w*|thoughts?|urges?|do it|cutting|cut|hurt\w*|tempted|suicidal)\b")
# Now, in the same breath as the past.
_NOW_FORM = re.compile(r"\b(?:tonight|tomorrow|right now|yesterday|last night|today|this (?:morning|afternoon|evening|week|weekend)|(?:an?|\d+|one|two|three|a few|few|couple of) (?:hours?|days?|minutes?) ago|just now|earlier|if i|what if|would be|i wish|i hope|i think|i don't|i do|i just|i have|i'm|i am|i feel|i want to|i need to|i can't|i keep|i've been|i have been)\b(?! (?:in recovery|recover\w+|clean|free|sober|a survivor|(?:so |very |really )?(?:grateful|proud|glad|happy|thankful)|fine|ok|okay|good|better|well|doing|all right|alright|\d+|over (?:it|that)|past (?:it|that)|here|alive|strong\w*|now|celebrating|a grand\w+)\b)")
_THEN = re.compile(r"\b(?:when i was|as a (?:teen\w*|kid|child)|growing up|back (?:in|then)|in (?:high school|college|school|my (?:teens|twenties))|used to|years? ago|decades? ago)\b")
_PAST_TENSE = re.compile(r"\bi (?:\w+ )?(?:was|wanted|tried|felt|thought|used to|attempted|couldn't|didn't)\b")
_BREAK = re.compile(r"[.?!;,\n]+|\b(?:and|but|so|because|then|though|although|yet|while|plus)\b")
_LOST = re.compile(rf"\b(?:died|passed away|passed (?:in|last|on|this|two|three|\d+)|(?:passed|is gone|are gone)\W*(?:$|[.!?,])|lost (?:my|our) (?:\w+ )?(?:{_PERSON}|dog|cat|pet|baby)|lost (?:him|her|them)(?=\W*(?:$|[.!?,]|last|this|in|two|three|\d|to|and|years?|months?|too))|lost a (?:\w+ )?(?:friend|family member|loved one|patient|coworker|classmate|child|baby|brother|sister|parent|pet|student|neighbou?r)|funeral|took (?:his|her|their) (?:own )?li(?:fe|ves)|(?:killed|hanged|hung|shot|drowned) {_THEMSELVES}|committed suicide|died by suicide|suicide of|death of|anniversary of|we lost|widow\w*|buried (?:my|our|him|her))\b")
_FAMILY = re.compile(rf"\b(?:my|our) (?:\w+ )?(?:{_PERSON}|dog|cat|pet)\b|\b(?:grandma|grandpa|mom|mum|dad)\b")
# A story, an essay, an "in theory": the whole message is about it.
_FRAMED = re.compile(r"\b(?:hypothetic\w+|theoretic\w+|in theory|(?:for|in) (?:a|my|the|an) (?:school |college |class )?(?:story|novel|book|essay|paper|project|class|screenplay|research|article|assignment|thesis)|(?:doing|writing|wrote|reading|presenting) (?:an?|my|the) (?:essay|paper|project|article|dissertation|presentation|report) (?:on|about))\b")
_ABOUT_THE_SUBJECT = re.compile(
    r"\b(?:what (?:should|do|can|would|could) (?:someone|somebody|a person|people|one|you|i|we) (?:do|say)|how (?:do|can|should|would|could) (?:i|you|we|someone|people) (?:help|support|talk to|know if|tell if|comfort|prevent)|if (?:someone|somebody|a (?:person|member|friend))|"
    r"what is|what are|what's the|what does|is (?:suicide|self-harm)|why (?:do|would|does|did) (?:some |most |so many |any )?(?:people|teens|teenagers|kids|someone|anyone|men|women|girls|boys|doctors|veterans)|has anyone|have (?:they|researchers|scientists)|is there (?:any )?(?:research|evidence|a link)|whether|does (?:\w+ ){1,3}(?:affect|cause|increase|reduce|raise|help with|lead to)|risk of|in general|generally|what(?:'s| is) it for|is it only|does (?:this|the|your) app|do you think|people who|statistics|warning signs|signs of|what age|suicide rate|\w+ considered|why (?:is|are) (?:the )?|how common|(?<!don't )(?:what(?:'s| is)|is there|do you have|need|give me|number for|got)(?: \w+){0,4} (?:hot ?line|help ?line|lifeline|crisis line)(?: number)?|(?:hot ?line|help ?line|lifeline|crisis line) number)\b")
# The person writing, just before it: then it is not a question about the subject.
_MY_STATE = re.compile(r"\b(?:i'm|i am|i feel|i felt|i've been|i've had|i've|i have|i had|i was|i keep|i get|i want|i'd|i wish|i think|i still|i start|having|feeling|been|my|me|i)\b(?:\W+(?!(?:help|support|talk|know|tell|comfort|prevent|read|someone|somebody|a|people|friend|writing|reading|doing|studying|researching|presenting|teaching|learning|wrote|watched|saw|heard)\b)[\w']+){0,5}\W*$")
# "Suicidal thoughts again tonight what do I do": nobody named, and said of oneself.
_BARE_STATE = re.compile(r"^(?: (?:thoughts|ideation|feelings|urges))?(?: (?:again|and|today|tonight|right now|every|all|lately|now|constantly|at night|since|really|so|badly)\b|\W*$|[,.!]| what (?:do|can|should) i| help| i )")
# They say so themselves, whatever else the message is.
_ADMITS = re.compile(r"\b(?:because i(?: do| am|'m)\b|(?:(?:jk|and|actually|but|no|really)[, ]+)*(?:it's |its )(?:really )?(?:me|for me|about me)\b|asking for me\b|i(?:'m| am) (?:going to|gonna|about to) do it\b|i want to do it\b|made me want to\b|i(?:'m| am) ready\W*(?:$|[.!?])|(?:it|that) made me want to\b|thinking (?:of|about) doing it\b|doing it (?:too|anyway|myself)\b|(?:so|and) (?:do|am|will) i\W*(?:$|[.!?])|\bme too\W*(?:$|[.!?])|now i (?:do|am)\W*(?:$|[.!?])|i want to (?:as well|too)\b|i(?:'ll| will) do it too\b|said i'd do it too\b)")
# Somebody else did, and they mean to follow.
_FOLLOW = re.compile(r"\b(?:i'm next\b|it's my turn\b|now it's me\b|(?:do|doing) the same(?: thing)?\b|follow(?:ing)? (?:him|her|them)\b|join(?:ing)? (?:him|her|them)\b|go(?:ing)? (?:the same way|with (?:him|her|them|my \w+)|too)\b|be with (?:him|her|them) (?:soon|tonight|again|now)\b|want(?:ing)? to (?:as well|too)\b|thinking (?:of|about) (?:it|doing it|the same)\b|stop thinking about doing it\b|end up the same\b)")
_STRONG_SELF = re.compile(rf"{_MYSELF}|\bmy (?:own )?life\b|\bi (?:really |just )?want(?:ed)? to (?:die|talk about wanting to die)\b|\bi'm suicidal\b|\bi feel suicidal\b|\bi (?:was (?:suicidal|thinking|going to|planning|about to|ready to)|wish|hope|don't want)\b")
# At work, or on a course: the word is theirs to use.
_JOB = re.compile(r"\b(?:(?:i'm|i am|as|i was|i work as|working as)(?: an?)? (?:\w+ ){0,2}(?:nurse|therapist|psychologist|psychiatrist|counsel?lor|social worker|doctor|physician|paramedic|emt|firefighter|police officer|cop|dispatcher|teacher|chaplain|pharmacist|vet|caseworker|medic|midwife|carer|crisis worker)|i (?:teach|lecture|facilitate|lead|run|present)\b[^.?!]{0,60}\b(?:first aid|class|workshop|session|training|course|group|suicid\w*|self-harm)|i (?:work|volunteer|intern|teach|train(?:ed)?|am interning|worked|volunteered)\b[^.?!]{0,50}\b(?:hot ?line|crisis line|lifeline|help ?line|er|emergency room|a&e|icu|psych|ward|clinic|hospital|hospice|shelter|teens|veterans|school|rehab|helpline|samaritans|suicid\w*)|my (?:patients?|clients?)|(?:a|one of my|our) (?:patient|client)s?|on (?:my )?shift|at work (?:on|about|today)|(?:a|the|my|our) (?:training|course|workshop|lecture|seminar|talk|conference)\b[^.?!]{0,30}\b(?:on|about)|training (?:at work )?was (?:on|about)|mental health first aid|first aid (?:course|class|training)|(?:professor|lecturer|teacher|speaker|pastor|boss) (?:talked|spoke|lectured|told us) about)\b")
_MY_PERSON = re.compile(rf"\b(?:my|our) (?:own )?(?:\w+ )?(?:{_PERSON})s?(?:'s|'|s)?\b")
_CARED_FOR = re.compile(r"\b(?:patients?|clients?|callers?|teens?|teenagers|students?|veterans?|residents?|people|kids|someone)\b")
_IN_IT = re.compile(r"\b(?:about|where|in which|who|that|characters?|woman|man|girl|boy|guy|he|she|they)\b[^.?!]{0,20}$")
# A story: somebody does it in it, and nobody does it here.
_STORY_CUE = re.compile(r"\b(?:movies?|films?|novels?|books?|shows?|series|episodes?|eps?|soaps?|season|finale|plots?|characters?|scenes?|spoilers?|opera|play|musical|memoir|biograph\w+|documentar\w+|podcast|hamlet|shakespeare|netflix|hbo|watch(?:ed|ing)?|rewatch\w*|binge[- ]?watch\w*|reading|re-?read|at the end|the ending|in the end|last scene|video game|game of|lyrics?|song)\b")
_NARRATED = re.compile(rf"\b(?:kills|hangs|shoots|drowns|stabs|poisons|jumps|drives|throws) (?:{_THEMSELVES}|off|in front|from|over)\b")

# Asking how. Never answered whatever it is wrapped in, and never set aside.
_DEADLY = r"(?:fatal|lethal|deadly|kill (?:a person|someone|somebody|me|you|a human|myself|yourself|oneself|themselves)|dangerous enough)"
_METHOD = _rules(
    rf"\bhow (?:many|much)\b[^.?!]{{0,50}}\b(?:to die|to kill(?= ?(?:$|[?.!,]|me\b|myself|you\b|yourself|someone|somebody|a (?:person|human|man|woman)|him\b|her\b|them\b|an? adult|one(?:self)?\b))|to overdose|to od|to end (?:it|my)|lethal|fatal|deadly|would kill (?:me|you|someone|a)|will kill (?:me|you|someone|a)|take to kill (?:me|you|someone|a))\b", rf"\b(?:lethal|fatal|deadly) (?:dose|amount|quantity|level)\b(?! of (?:sugar|salt|carbs|caffeine in))|\b(?:lethal|fatal|deadly) combination (?:of|for|to)\b", rf"\bwhich of (?:my|the|these) (?:{_PILLS}|\w+)\b[^.?!]{{0,60}}\b{_DEADLY}\b", rf"\b(?:would|could|can|will|that) (?:kill (?:a person|someone|somebody|a human)|stop (?:a person's|someone'?s|my|a|your) heart)\b(?!'s| from)",
    r"\b(?:painless|easiest|quickest|fastest|best|least painful|surest|peaceful|quick|easy|sure|clean) (?:ways?|methods?) (?:to|of|for) (?:\w+ )?(?:die|dying|kill(?:ing)? (?:myself|yourself|oneself|someone|themselves|a person)|commit(?:ting)? suicide|suicide|end(?:ing)? (?:my|your|a|it|one's|their) ?(?:life|all)?|overdos\w+|self-harm|hurt(?:ing)? myself)\b",
    r"\b(?:ways?|methods?|how|guide) (?:to|of|do i|do you|can i|could i|would i|would someone|does someone|do people|would a (?:character|girl|boy|person)(?: \w+){0,3}|could a character|can someone) (?:(?!not\b|avoid|help|stop|prevent|support|talk|comfort|know|tell)\w+ ){0,2}(?:kill (?:myself|yourself|oneself|themselves|himself|herself)|commit suicide|suicide|end (?:my life|it|their life|your life)|overdose|hang (?:myself|yourself|themselves)|slit|die)\b(?! (?:of|from|with|in) )",
    rf"\bwhat (?:would|will) happen if (?:someone|somebody|a person|i|you|he|she) (?:swallowed|swallow|took|take|drank|ate)\b[^.?!]{{0,30}}\b(?:everything in|(?:all|every one) (?:of )?(?:my|the|his|her) (?:\w+ )?(?:pills?|meds|medications?|medicine|tablets|insulin|sleeping|painkillers)|(?:a|the) whole (?:bottle|pack|box)(?! of (?:wine|water|soda|juice|milk|cookies|crackers|cereal)))\b",
    r"\bways to die\b", r"\bways (?:that )?(?:people|someone|others|teens|they|girls|boys) (?:kill themselves|end their (?:own )?lives|commit suicide|die by suicide|overdose|do it)\b", r"\bhow to die\b", r"\bhow (?:deep|long) (?:do|does|should|would|to)\b[^.?!]{0,30}\b(?:cut|bleed)\b[^.?!]{0,20}\b(?:die|wrists?)\b", r"^(?=.*\b(?:suicid\w*|kill\w*|dies?|death|hang\w*|overdos\w+|jump\w*)\b).*\b(?:describe|explain|show|tell me|write)\b[^.?!]{0,40}\bhow (?:she|he|they) (?:does|do|did) it\b",
    r"\bguide (?:for|to)\b[^.?!]{0,50}\b(?:stop living|die|end (?:it|their life|her life|his life)|suicide)\b", r"\b(?:end (?:their|her|his|your|my) life|suicide|die)\b[^.?!]{0,50}\bwhat would (?:they|she|he|i|you) use\b",
)
_METHOD += _rules(
    r"\b(?:what|which) (?:pills?|meds?|medications?|drugs?|poisons?|tablets?|plants?) (?:would|could|can|will|might|do) (?:\w+ )?kill (?:me|you|a person|someone|people)\b",
    rf"\b(?:can|will|would|could) (?:i|you|someone|a person|somebody) (?:die|be dead|not wake up) (?:if|from|by|after|of)\b[^.?!]{{0,60}}\b(?:(?:all|a bottle|the whole|too many|too much|lots|every one) (?:of )?(?:my |the |his |her )?)(?:\w+ ){{0,2}}(?:{_DRUGS})\b", r"\bcan (?:you|i) die from too much (?:insulin|metformin|tylenol|paracetamol|ibuprofen|advil|aspirin|xanax|my (?:meds|medication|pills))\b",
)
_METHOD_HELP = re.compile(r"\b(?:avoid|prevent|stop (?:someone|him|her|them|my|people)|help (?:someone|him|her|them|my|a|people)|without overdosing|not overdose)\b")

# ---- several small things at once ----------------------------------------------------------
# No phrase above, and still: what people say around it, added up. Food and
# laughter count against it. Only ever enough to check in.
_WEIGHTS = [(re.compile(pattern), weight) for pattern, weight in (
    (r"\b(?:die|dying|death|suicid\w*|alive|kill|killing)\b", 2.0), (r"\b(?:goodbyes?|farewell|forever|permanently|for good|no more|last time|the end|end it|ending it)\b", 1.5), (r"\b(?:without me|disappear|vanish|not be here|not here|wasn't here|wasn't around|stop existing|gone)\b", 1.5),
    (r"\b(?:gun|rope|noose|blade|razor|bridge|rooftop|train tracks|the wheel)\b", 1.5), (rf"\b(?:all (?:of )?my|the) {_PILLS}\b", 1.5), (r"\b(?:tired of (?:everything|it|all|this|fighting)|can't (?:go on|anymore|keep|take)|don't see|nothing matters|pointless|hopeless|no reason|no one|nobody|not ok|not okay|alone)\b", 1.0),
    (r"\b(?:scared|pain|hurt|hurting|numb|empty|hate|burden|lost)\b", 0.5), (r"\b(?:tonight|tomorrow|soon|right now)\b", 0.5), (r"\b(?:i|i'm|i've|i'll|me|myself)\b", 0.5), (r"\b(?:it|everything|this) (?:all )?(?:finally )?(?:stops?|ends?|be over)\b", 1.5),
    (r"\b(?:eat|eating|ate|food|meals?|recipes?|snacks?|diet|calories?|weight|lunch|dinner|breakfast|cook|cooking|protein|carbs?|sugar|soda|sweets|bread|coffee|wine|alcohol|smoking|cigarettes|junk|fast food|takeout|takeaway|workout|gym|plan|app|password|health number|vitamins?|supplements?|cancer|disease|heart (?:attack|disease)|risk)\b", -1.5),
)]
_ENOUGH = 4.0


def _weigh(text: str) -> float:
    return sum(weight * min(len(pattern.findall(text)), 2) for pattern, weight in _WEIGHTS) - (3.0 if _JOKING.search(text) else 0.0)


def second_reading_text(message: str) -> str:
    """What `second_reading.py` reads: the words, without what is plainly something else."""
    return _aside(_unnamed(forms(message)[0])).kept


def _first(patterns: list[re.Pattern], text: str) -> re.Match | None:
    for pattern in patterns:
        found = pattern.search(text)
        if found:
            return found
    return None


_FIRST_PERSON = re.compile(r"\b(?:i|i'm|i've|i'd|i'll|me|my|mine|myself)\b")
_IS = re.compile(r"\b(?:is|are|isn't|can't|i'm|won't|feels?|keeps?|having|right now)\b")
# Declared in so many words: with a laugh it is usually a figure of speech. What
# they have done, hold or have written is not, however it is told.
_DECLARED = re.compile(r"\b(?:kill(?:ing)? myself|kms|jump(?:ing)?|shoot(?:ing)? myself|hang(?:ing)? myself|drown(?:ing)? myself|end(?:ing)? (?:it|it all|my life)|die|dead)\b")
# The clause after it makes it theirs: "my husband doesn't know but suicide is on my mind".
_MINE_AFTER = re.compile(r"\b(?:(?:on|in|through|from) my (?:mind|head|thoughts)|haunt\w* me|won't leave me|follows? me|(?:the (?:note|letter) )?i wrote|for me|i have|i've had|i get|i'm having)\b")
_HAVING = re.compile(r"\W*(?:still |just |been |so |really |constantly |always )*(?:having|feeling|been|felt|got|getting|struggling with|dealing with|fighting)\b")
# What they do not know of is not theirs: "my mother doesn't understand the suicidal thoughts".
_KNOWS = re.compile(r"\b(?:(?:doesn't|don't|didn't|won't|never|can't) (?:\w+ )?(?:understand|know|get|see|notice|believe|realize|care)|thinks (?:the|i'm|i|that i)\b|(?:found|saw|noticed|read|asked about) (?:my|the|it))\b")
_A_VERB = re.compile(r"^(?:\W+[\w']+){0,3}?\W+(?:is|are|was|were|won't|don't|keep|keeps|kept|came|come|comes|never|always|every|again|lately|tonight|constantly|since|hit|hits|get|gets|got|crept|creep|stopped|didn't|it's)\b")
_THEY_DO = re.compile(r"^(?:is|was|wants|wishes|feels|says|hates|thinks|has|keeps|cuts|hurts|doesn't|isn't|hopes)\b")
# A question about a body: general, or only supposed.
_BODY_ASKS = re.compile(
    r"(?:^|[,:]|\b(?:and|but|so|also|hi|hey|hello|ok|okay|please|sprout|can you tell me|tell me|wondering|question|know)\b)\W*(?:(?:is|are)(?= (?:it|this|that|there|these|those|my|the|a|an|having|chest)\b)|(?:can|could|does|do|did|will|would|should)(?= (?:it|this|that|i|you|he|she|they|we|someone|somebody|people|a|an|the|too|eating|taking|drinking|my)\b)|"
    r"(?:can|could|does|do|will|would) (?!not\b|n't)[a-z]+(?: [a-z]+){0,3} (?:cause|give|lead|make|mean|help|stop|prevent|trigger)\b|what if|why (?:do|does|would|is it that)|how (?:do|does|to|can|many|much)|which foods?|what foods?|what (?:causes?|are|is|should|do|would|happens)|signs? of|symptoms? of|risk of|causes? of|chance of)")
_SUPPOSED = re.compile(r"\bif\b|\bin case\b|\bwhen (?:someone|people|you|a person)\b")
_IS_IT_BAD = re.compile(r"\b(?:is it|it's|is this|is that)(?: \w+)? (?:bad|serious|dangerous|normal|ok|okay|an emergency|a problem)(?: \w+)? (?:if|that|when) (?:i|my|he|she|his|her)\b")
_THEIRS = re.compile(rf"\b(?:i|i'm|i've|my|me|he|he's|his|she|she's|her|they|their|my \w+)\b")


class _Reading:
    """One form of a message, and what can be found in it."""

    def __init__(self, text: str) -> None:
        self.text = text
        self.aside = _aside(text)
        self.back = bool(_BACK.search(text) or _STILL.search(text))
        self.clauses: list[tuple[int, int, bool]] = []
        at, then = 0, False
        for gap in [*_BREAK.finditer(text), None]:
            stop = gap.start() if gap else len(text)
            words = text[at:stop]
            if words.strip():
                past = bool(_PAST.search(words)) or (then and bool(_PAST_TENSE.search(words)))
                past = past and not _NOW_FORM.search(words)
                self.clauses.append((at, stop, past))
                then = past and (then or bool(_THEN.search(words)))
            if gap and re.search(r"[.?!;\n]", gap.group(0)):
                then = False                            # another sentence
            at = gap.end() if gap else stop

    def past(self, found: re.Match) -> bool:
        """Long over: every clause it touches is, and nothing says it is back."""
        if self.back or _AGAIN.search(self.sentence_of(found)):
            return False
        touched = [past for a, b, past in self.clauses if a < found.end() and b > found.start()]
        return bool(touched) and all(touched)

    def alive(self, patterns: list[re.Pattern]) -> list[re.Match]:
        return [m for pattern in patterns for m in pattern.finditer(self.text) if not self.aside.covers(m)]

    def whose(self, found: re.Match) -> str:
        """The nearest person in the clause it is in; failing that, whoever the
        sentence is about; failing that, the person writing."""
        if self.aside.somebody_elses(found):
            return OTHER
        if _FIRST_PERSON.search(found.group(0)):
            return SELF
        text = self.text
        a, b = next(((a, b) for a, b, _ in self.clauses if a <= found.start() < b), (0, len(text)))
        before, after = text[a:found.start()], text[found.end():b]
        if re.search(r"^ note\b[^.?!]*\b(?:in|on|under) (?:my|his|her|their|the) \w+'s\b", after):
            return OTHER                                # found in somebody's room
        if re.search(r"\bmy (?:own )?$", before) or _MINE_AFTER.search(after):
            return SELF
        nearest = self._nearest(before)
        if nearest is not None:
            if nearest.group("third"):
                return SELF if _KNOWS.search(before[nearest.end():]) else OTHER
            return UNCLEAR if _READING.search(before) else SELF
        first, last = _sentence(text, found.start(), found.end())
        prior = text[first:a]
        nearest = self._nearest(prior)
        if nearest is not None and nearest.group("third"):
            if _THEY_DO.search(found.group(0)) or _THEY_DO.search(before.strip()):
                return OTHER
            if _LOST.search(prior):
                return SELF                             # "my wife died, and tired of living": not hers
            joined = prior.rstrip()
            if _A_VERB.search(after) or joined.endswith((",", ";")) or re.search(r"\b(?:but|because|so)$", joined):
                return SELF
            return OTHER
        if nearest is not None:
            return UNCLEAR if _READING.search(text[first:found.start()]) else SELF
        if _HAVING.match(text[first:found.start()]):
            return SELF
        if self.asked(found) or (text.rstrip().endswith("?") and not re.search(r"\b(?:i|i'm|me|my)\b", text)):
            return UNCLEAR
        return OTHER if _LOST.search(text[first:last]) else SELF

    @staticmethod
    def _nearest(words: str) -> re.Match | None:
        nearest = None
        for nearest in _WHO.finditer(words):
            pass
        return nearest

    def asked(self, found: re.Match) -> bool:
        """Is it being asked about, rather than said? Only by what is in its own
        sentence, and never when the person writing is what stands before it."""
        if _STRONG_SELF.search(found.group(0)):
            return False
        first, last = _sentence(self.text, found.start(), found.end())
        lead = self.text[first:found.start()]
        if _MY_STATE.search(lead):
            return False
        if _FRAMED.search(self.text):
            return True
        if not _ABOUT_THE_SUBJECT.search(self.text[first:last]):
            return False
        return not (not re.search(r"\w", lead) and found.group(0).startswith(("suicidal", "self-harming", "overdosed")) and _BARE_STATE.search(self.text[found.end():last]))

    def body_asked(self, found: re.Match) -> bool:
        """A question about a body in general, or one that is only supposed."""
        first, last = _sentence(self.text, found.start(), found.end())
        lead = self.text[first:found.start()]
        marks = list(_BODY_ASKS.finditer(lead))
        if _ADMITS.search(self.text) or not marks or _IS_IT_BAD.search(self.text[first:found.end()]):
            return False
        between = lead[marks[-1].end():]
        if _SUPPOSED.search(between):
            return True
        return not (_THEIRS.search(between) or _FIRST_PERSON.search(found.group(0)) or re.search(rf"\b{_SOMEBODY}\b", found.group(0)))

    def told_in_a_story(self, found: re.Match) -> bool:
        """A film or a book in its own sentence, or the way a plot is told; not
        somebody of theirs, and not the person writing."""
        if _MY_PERSON.search(found.group(0)) or _MY_STATE.search(self.lead_of(found)):
            return False
        first, last = _sentence(self.text, found.start(), found.end())
        return bool(_NARRATED.search(found.group(0)) or (_STORY_CUE.search(self.text[first:found.end()]) and not _MY_PERSON.search(self.text[first:last])))

    def sentence_of(self, found: re.Match) -> str:
        first, last = _sentence(self.text, found.start(), found.end())
        return self.text[first:last]

    def clauses_of(self, found: re.Match) -> str:
        touched = [(a, b) for a, b, _ in self.clauses if a < found.end() and b > found.start()]
        return self.text[touched[0][0]:touched[-1][1]] if touched else self.text

    def lead_of(self, found: re.Match) -> str:
        """What stands before it in its own clause."""
        return next((self.text[a:found.start()] for a, b, _ in self.clauses if a <= found.start() < b), "")

    def clause_of(self, found: re.Match) -> str:
        return next((self.text[a:b] for a, b, _ in self.clauses if a <= found.start() < b), self.text)


def _read(text: str) -> Assessment:
    """One form of the message."""
    for_a_friend = "asking for a friend" in text and not _ADMITS.search(text)
    reading = _Reading(text.replace("asking for a friend", " "))
    how = reading.alive(_METHOD)
    if how and not _METHOD_HELP.search(text):
        return Assessment(SELF_HARM)
    found = _read_with(reading, for_a_friend)
    if reading.aside.taken_back and not found.hand_over:
        return Assessment(SELF_HARM, hurt=found.harmed)
    return found


def _read_with(reading: _Reading, for_a_friend: bool) -> Assessment:
    text, kept = reading.text, reading.aside.kept
    joking = bool(_JOKING.search(text))
    admits = bool(_ADMITS.search(text))
    strong = any(not reading.aside.somebody_elses(m) for m in reading.alive([_STRONG_SELF]))
    at_work = bool(_JOB.search(text))
    others = [m for m in reading.alive(_OTHER_RISK) if not (reading.told_in_a_story(m) and not _NOW.search(kept)) and not (at_work and _CARED_FOR.search(m.group(0)))]

    # A plan, the means, a time.
    imminent = reading.alive(_IMMINENT)
    if joking:
        imminent = [m for m in imminent if not (_DECLARED.search(m.group(0)) or _TOWARDS.search(m.group(0)))]
    if at_work:
        imminent = [m for m in imminent if _FIRST_PERSON.search(m.group(0)) or _MY_STATE.search(reading.lead_of(m))]
    now = [m for m in imminent if not reading.past(m)]
    if now:
        quoted = all(reading.aside.somebody_elses(m) for m in now)
        theirs = all(not _FIRST_PERSON.search(m.group(0)) and reading.whose(m) == OTHER for m in now)
        hers = others and not strong and not any(_FIRST_PERSON.search(m.group(0)) for m in now)
        return Assessment(IMMINENT, about=OTHER if quoted or theirs or hers else SELF, harming=any(_TOWARDS.search(m.group(0)) for m in now))

    # Their own intent, before anything that is also true: that somebody hurts
    # them, that somebody died, that it was worse once.
    own = [m for m in reading.alive(_SELF_HARM) if _FIRST_PERSON.search(m.group(0)) or not (reading.told_in_a_story(m) and reading.whose(m) == OTHER)]
    words = [m for m in reading.alive([_SUBJECT_WORDS]) if not (at_work and (_CARED_FOR.search(reading.lead_of(m)) or not _MY_STATE.search(reading.lead_of(m)))) and not (not admits and not _RELATES.search(text) and reading.told_in_a_story(m) and _IN_IT.search(reading.lead_of(m)))]
    spoken = [m for m in (*own, *words) if not reading.past(m) and reading.whose(m) in ((SELF, UNCLEAR) if admits else (SELF,))]
    mine = [m for m in spoken if admits or not reading.asked(m)]
    if mine and others and not strong and all(m in words for m in mine) and any(reading.asked(m) for m in (*words,)):
        mine = []                                       # asked about, for them
    if for_a_friend and not strong:
        mine = []
    if not mine and _FOLLOW_SELF.search(text) and ((admits and _SUBJECT.search(text)) or (_FOLLOW.search(text) and _GONE.search(text))):
        return Assessment(SELF_HARM)
    when = any(m for m in reading.alive([re.compile(rf"\b{_WHEN}\b")])) or bool(_PLANNED.search(text))
    if mine and when and not joking:
        return Assessment(IMMINENT)

    # A body that needs help now.
    for body in reading.alive(_BODY):
        if reading.past(body) and not _IS.search(body.group(0)):
            continue
        clause = reading.clause_of(body)
        if _LOST.search(clause) and not re.search(r"\b(?:i'm|i've|i took|help|now)\b", clause):
            continue
        if at_work and not re.search(r"\b(?:i'm|i've|i|my (?!patients?|clients?|shift)\w+)\b", body.group(0)):
            continue
        if _NUMBED.search(reading.sentence_of(body)) or (_SETTLED.search(text) and not _IS.search(body.group(0))):
            continue
        about = reading.whose(body)
        if re.search(rf"\b{_SOMEBODY}\b", body.group(0)) and not re.search(r"\b(?:i|i'm|me)\b", body.group(0)):
            about = OTHER
        if reading.body_asked(body):
            about = UNCLEAR
        elif about == UNCLEAR:
            about = SELF
        # Took too much and wants to die, or meant to: the greater worry names it.
        meant = any("overdos" not in m.group(0) for m in mine) or (bool(_MEANT_HERE.search(text)) and bool(_TAKEN.search(body.group(0))))
        return Assessment(IMMINENT if meant and about == SELF else MEDICAL, about=about)

    harm = reading.alive(_HARMED)
    hurt = any(not reading.past(m) for m in harm)
    if mine:
        return Assessment(SELF_HARM, hurt=hurt)
    theirs = [m for m in own if not reading.past(m)]
    if any(reading.aside.somebody_elses(m) for m in theirs):
        return Assessment(SELF_HARM, about=OTHER)

    # Could mean it, could not: theirs comes before what is done to them.
    checks = [m for m in reading.alive(_CHECK) if not reading.past(m)]
    loose = [m for m in checks if _LOOSE.search(m.group(0)) and not _GRAVE.search(text)
             and (_MUNDANE.search(_NOT_ONLY.sub(" ", reading.sentence_of(m))) or (re.search(r"\bwe\b", reading.lead_of(m)) and _MUNDANE.search(text)))]
    checks, mundane = [m for m in checks if m not in loose], bool(loose)    # the diet, the app, the neighbor's dog
    laughed = joking and _weigh(kept) < 0
    elsewhere = bool(re.search(r"\bkeeps? saying (?:she|he|they)\b|\b(?:she|he|they) wants?\b", text)) and not strong
    others_now = [m for m in others if not reading.past(m)]
    if not others_now and not laughed and not elsewhere and any(reading.whose(m) == SELF for m in checks):
        return Assessment(CHECK_IN, hurt=hurt)
    if others_now:
        return _somebody_else(reading, others_now[0], False)
    if theirs:
        about = UNCLEAR if for_a_friend or reading.asked(theirs[0]) else reading.whose(theirs[0])
        return _somebody_else(reading, theirs[0], False) if about == OTHER else Assessment(SELF_HARM, about=about)
    if hurt:
        return Assessment(IMMINENT, harmed=True)

    for word in [m for m in words if not reading.past(m)]:
        about = reading.whose(word)
        if for_a_friend or (about == SELF and reading.asked(word)):
            about = UNCLEAR
        if about == OTHER:
            return _somebody_else(reading, word, False)
        return Assessment(SELF_HARM, about=about)

    if checks and not laughed:
        return Assessment(CHECK_IN, about=OTHER if elsewhere or all(reading.aside.somebody_elses(m) for m in checks) else SELF)
    if checks or mundane or (joking and any(not reading.past(m) for m in reading.alive(_IMMINENT))):
        return Assessment(unsure=True)                  # said with a laugh, or of the diet: asked, not told

    # Long over, and only that.
    over = [m for m in (*imminent, *own, *words, *reading.alive(_CHECK)) if reading.past(m)]
    if others and all(reading.whose(m) == OTHER for m in over):
        return _somebody_else(reading, others[0], True)
    if over:
        if _RECOVERED.search(text):
            return Assessment(steadier=True)            # they were, and say they are well
        if all(reading.whose(m) == OTHER for m in over):
            return _somebody_else(reading, over[0], True)
        return Assessment(IMMINENT if any(reading.past(m) for m in imminent) else SELF_HARM, past=True)
    if any(reading.past(m) for m in harm):
        return Assessment(IMMINENT, harmed=True, past=True)

    if _weigh(kept) >= _ENOUGH:
        return Assessment(CHECK_IN)
    if any(not reading.past(m) for m in reading.alive(_HEAVY)):
        return Assessment(DISTRESS)
    if _LOST.search(kept) and _FAMILY.search(kept):
        return Assessment(FEELINGS if _REQUEST.search(kept) else DISTRESS, about=OTHER, past=True, feeling="sad")
    return _feeling(kept)


def _feeling(kept: str) -> Assessment:
    if not _NOT_FEELING.search(kept):
        calmed = _DOWN_NOT_SAD.sub(" ", kept)
        for name, pattern in _FEELING.items():
            if pattern.search(calmed):
                return Assessment(FEELINGS, feeling=name)
    return Assessment()


# ---- what else is in the message ----
_FOLLOW_SELF = re.compile(r"\b(?:i'm|i am|i'll|i will|i want|i have|i can't|i keep|i think|i might|i could|i should|i'd|thinking|and i|so do i|me too|now i|it's me|i've)\b")
_SUBJECT = re.compile(r"\b(?:suicid\w*|self-harm\w*|kill\w* (?:my|him|her|them|your)sel\w+|overdos\w+|(?:want\w*|wanting) to die|hang\w* (?:him|her)self|end\w* (?:his|her|their|your) life)\b")
_GONE = re.compile(rf"\b(?:suicid\w*|(?:killed|hanged|hung|shot|drowned) {_THEMSELVES}|kill (?:him|her|them)sel\w+|overdos\w+|took (?:his|her|their) (?:own )?life)\b|\b(?:died|passed(?: away)?|gone)\b(?=.*\b(?:go with|join|follow) (?:him|her|them)\b)")
# The dentist, or what it turned out to be.
_NUMBED = re.compile(r"\b(?:dentist|novocaine|lidocaine|numbing|botox|an(?:a)?esthe\w+|root canal|filling)\b")
_SETTLED = re.compile(r"\bturned out (?:to be|it was|fine|ok)\b|\b(?:er|doctor|urgent care|hospital|cardiologist|paramedics?)\b[^.?!]{0,30}\b(?:said|ruled|cleared|told me)\b[^.?!]{0,40}\b(?:fine|nothing|just|only|normal|okay|ok|clear|anxiety|out)\b|\bcame back (?:normal|fine|clear|negative)\b|\bgot the all clear\b|\bcleared (?:me|by)\b")
# A plan, a date, the means: with their own intent it is now.
_PLANNED = re.compile(r"\b(?:i(?:'ve| have) (?:got )?a plan|have a plan (?:to|for|and)|set a date|picked (?:a|the) (?:day|date|place|spot)|gun is (?:loaded|right)|(?:bought|got|have|tied|found) (?:a|the|some|my) (?:rope|noose|gun|pistol|blade)|i know (?:how|when|where) (?:i'll|i'm going to|to do it)|tell my (?:kids|son|daughter|mom|mum|wife|husband|family) i(?:'m sorry| love))\b")
_TAKEN = re.compile(r"\b(?:took|taken|taking|swallow\w*|overdos\w+|downed)\b")
# What somebody is tired of, or cannot stand, when it is not life.
_MUNDANE = re.compile(
    r"\b(?:diet\w*|keto|paleo|carbs?|sugar|salads?|chicken|takeout|chocolate|bread|soda|junk food|snack\w*|recipes?|meals?|meal prep|fast(?:ing)?|cravings?|calorie\w*|macros|pounds|lbs|weight|scale|steps|goal|marathon|gym|workout\w*|burpees|plank|squats?|treadmill|yoga|class|trainer|statins?|medications?|insulin shots?|app|log ?in|password|page|website|screen|wifi|update|notification\w*|membership|subscription|trial|program|"
    r"i mean(?! it\b)|showers?|oats|hummus|peanut butter|almonds?|nuts|kale|smoothies?|eggs|oatmeal|vegetables?|veggies|fruit|cheese|pizza|fries|rice|pasta|yogurt|soup|sauce|juice|beans|tofu|fish|track(?:ing)?|log(?:ging)?|weigh\w*|count(?:ing)?|groceries|grocery|pants|laps|cancel\w*|refund|minutes|reps|miles|laps|stairs|hill|lasagna|dinner|lunch|breakfast|cook\w*|job|boss|work|meetings?|conference|hotel|office|commute|traffic|flight|red-?eye|vacation|beach|book|party|potluck|neighbor\w*|barks?|snor\w+|music|laundry|dishes|homework|exam|lease|moving|results|cauliflower|salmon|smoothie|shirt|floor|jeans|birthday cake|restaurant|movie|yard|garden|coffee|alcohol|wine|smoking|cigarettes?|netflix|phone|email\w*|spreadsheet|deadline|toddler|diapers|potty)\b")
_NOT_ONLY = re.compile(r"\bnot (?:just|only|out of|about|even|the|my|this)(?: (?!and\b|but\b)\w+){0,3}")
# Said of life and of burpees alike.
_LOOSE = re.compile(r"(?:can't|don't think i can|not sure i can) (?:go on|keep going|carry on|keep doing this|do this anymore|take (?:it|this) anymore|handle (?:it|this) anymore|face (?:tomorrow|another day))|don't (?:\w+ )?want to (?:be here|do this anymore|keep going|go on)|want(?:s|ed|ing)? to (?:just )?(?:disappear|vanish|sleep forever|be gone)|want (?:it|everything|this)(?: all)? to (?:end|stop|be over)|"
                    r"wish (?:i could|to) (?:just )?(?:disappear|vanish)|i'm (?:so )?done|so tired of (?:fighting|trying|it all|all of it|everything)|nobody would notice|would (?:anyone|anybody|you|the app|they|somebody|someone|people)|if i was gone|doesn't matter anymore|don't care what happens\b(?! to me)|everything(?:'s| is) (?:pointless|too much)|see the point|no point|point (?:of|in)|how much longer i can|tired of waking up|hopeless")
_GRAVE = re.compile(r"\b(?:die|dying|dead|death|suicid\w*|kill\w*|alive|living|life|live|hurt(?:ing)? myself|harm\w*|self-harm\w*|pills|overdos\w*|goodbye|hopeless|worthless|burden|no one|nobody (?:cares|would)|can't cope|crying|empty|numb|alone|end it|ending it|anymore and|no point|pointless|hate myself|suffering|funeral|heaven|everyone|without me)\b")
_TOWARDS = re.compile(r"\b(?:kill|stab|shoot|strangle|attack|hurt) (?:him|her|them|someone|somebody|everyone|people|my (?:husband|wife|partner|kids?|son|daughter|mother|father|mom|dad|boss|neighbou?r|ex|baby|brother|sister))\b|\bnearly hurt (?:him|her|them|my \w+)\b")

_RECOVERED = re.compile(r"\b(?:clean|recovered|in recovery|good now|fine now|better now|well now|doing (?:really |so |much )?(?:great|well|better|good)|clean ever since|so (?:grateful|happy|glad|proud)|grateful|celebrat\w+|proud|long behind me|behind me now|love it now|and love it|thriving|free of it|finally (?:like|love|enjoy\w*|happy|sleeping|eating|feel(?:ing)? (?:good|better|like myself)))\b")
# Somebody else, and it is happening.
_NOW = re.compile(r"\b(?:has a (?:gun|knife|rope)|gun|rifle|tonight|today|right now|locked (?:him|her|them)sel\w+|hung up|phone is off|just (?:said|posted|texted|told|left|walked|called)|walked out|not answering|won't answer|can't get hold of|can't reach|phone'?s off|(?:\d+|ten|five|a few) min(?:ute)?s ago|letter on (?:his|her|their) bed|finishing it tonight|for good|going to (?:kill|shoot|hang|end|jump)|last night alive|on the (?:roof|bridge|ledge))\b")
_PUBLIC = re.compile(r"\b(?:singer|actor|actress|celebrity|rapper|musician|athlete|politician|influencer|streamer|fictional|character)s?\b")
_REQUEST = re.compile(r"\?|\b(?:what (?:can|should|do)|how (?:do|can|to)|does that|does it|is it|count as|which|recipe|suggest|ideas?|can i|should i)\b")


def _somebody_else(reading: _Reading, found: re.Match, past: bool) -> Assessment:
    """Somebody other than the person writing: at risk now, or long ago, or
    gone, or nobody in particular. Only what is said of them says which."""
    kept, said, sentence = reading.aside.kept, reading.clauses_of(found), reading.sentence_of(found)
    asking = bool(_ABOUT_THE_SUBJECT.search(sentence) or _FRAMED.search(reading.text))
    risk_now = re.search(r"\b(?:will|going to|says|said he|said she|threaten\w*|wants? to|is (?:cutting|hurting|suicidal|self-harming|talking)|and (?:is|keeps) )\b", sentence)
    if (_LOST.search(said) or (_LOST.search(sentence) and "overdos" in found.group(0))) and not risk_now:
        if not _FAMILY.search(kept):
            return _feeling(kept)                       # the news, a singer, history
        if _NOW.search(sentence) and re.search(r"\b(?:just|tonight|today|now|minutes? ago|this morning)\b", sentence) and not re.search(r"\b(?:died|passed|funeral|years?|months?|weeks?|anniversary)\b", sentence):
            return Assessment(IMMINENT, about=OTHER)
        return Assessment(FEELINGS if _REQUEST.search(kept) else DISTRESS, about=OTHER, past=True, feeling="sad")
    if past or (_PUBLIC.search(sentence) and not _FAMILY.search(sentence)):
        return _feeling(kept)                           # they were, and it is over; or the news
    if not asking and _NOW.search(kept):
        return Assessment(IMMINENT, about=OTHER)
    somebody = re.search(rf"\b(?:my|our) (?:\w+ )?(?:{_PERSON}|family member|loved one)\b|\b(?:a|the) (?:\w+ )?(?:friend|family member|relative|loved one|colleague|coworker|classmate|student|client|patient|neighbou?r|roommate|kid|teen\w*|boy|girl|man|woman) (?:who|that|is|says?|said|wants?|has|keeps?)\b|\bsome(?:one|body) (?:i (?:know|love)|on|in)\b|\bi coach\b|\b(?:he|she|he's|she's|him|her|they're)\b", said)
    if asking and re.search(r"\bif (?:someone|somebody|anyone|anybody|a (?:person|member|user|friend))\b", sentence):
        somebody = None                                 # nobody in particular
    return Assessment(SELF_HARM, about=UNCLEAR if asking and not somebody else OTHER)


# ---- the message after a worrying one ---------------------------------------------------------

# In the day after, whatever came between.
_FOLLOWS = re.compile(r"\b(?:bye forever|goodbye (?:forever|everyone|world)|farewell|too late (?:now|for me)|(?:it's|its) too late(?! (?:to (?!stop\b|save\b|help\b)\w+|for (?:dinner|lunch|breakfast|coffee|a snack|the \w+))\b)|i(?:'ve| have)? (?:got |have )?(?:the |a |my |some |them )?(?:gun|razor|blade|rope|noose)\b|i(?:'ve| have)? (?:got|have) (?:the|them|all the|my|some) (?:pills?|tablets?)\b(?= ?(?:ready|here|now|with me|in|on|beside|next|out|$|[.!]))|i(?:'ve| have) got (?:them|it|everything) (?:ready|here|with me)|"
                      r"i'm (?:going to do it|on the (?:bridge|roof|ledge|edge))\b|(?:nobody|no one) can (?:help|stop) me|don't (?:try to )?stop me|already (?:took|taken) (?:them|all of them|some|it)|i(?:'ve)? (?:took|taken) (?:them all|all of them|the pills|the whole)|i(?:'ve| have)? (?:got |have |do have |really have )?a plan(?: for it| to do it)?(?=\W*(?:$|[.!?]))|i do have a plan(?=\W*(?:$|[.!?])))")
# Straight after it, and all there is.
_NEXT = re.compile(r"^(?:(?:yes|yeah|yep|ok|okay|and|but|well|no)[, ]+)*(?:goodbye|bye|bye bye|(?:it's |its )?too late|i(?:'ll| will) do it|i'm (?:doing it|going to|about to|ready)|i (?:did|took) (?:it|them|some|a lot|\d+)(?: all)?|i(?:'ve| have) (?:taken|done) (?:it|them|some|a lot)(?: all)?|i took (?:\w+ ){1,2}of them|i already (?:did|have|took (?:it|them|some))|i(?:'ve| have)? (?:got |have )?(?:a plan|the (?:means|pills|gun|rope|blade)|pills|a gun|a knife|my razor|them here)(?: (?:with me|here|ready|now))?|"
                   r"i can't (?:stop|hold on|promise(?: that| anything)?|wait)(?: anymore)?|(?:nobody|no one) can (?:help|stop)(?: me)?|(?:don't|please don't) (?:tell|call) (?:anyone|anybody|the police|my \w+)|i(?:'m| am) (?:not safe|alone|by myself|at the bridge|on the roof)|not safe|when (?:they|everyone|my \w+)(?:'s|'re| is| are)? (?:asleep|out|gone|at work|at school)(?: tonight| later| today)?|after (?:work|they(?:'re| are) asleep))[.! ]*$")
# The means, named in answer.
_MEANS = re.compile(r"^(?:(?:with|by|using|probably|maybe|i'd|i'll|i would|i will|i have|use|take|taking|swallow|just|all|my|the|a|some|of) )*(?:gun|pills?|tablets|knife|rope|razor|blade|insulin|meds|medication|hanging|jump(?:ing)?|overdos(?:e|ing)|drowning|the (?:car|train|bridge|roof))[.! ]*$")
# No to being helped, which is not "no, I'm all right".
_REFUSES = re.compile(r"^(?:no,? )?(?:i )?(?:won't|can't|don't want to|not going to|i'm not going to) (?:call|tell|talk to|text|ask) (?:anyone|anybody|someone|somebody|them|him|her|my \w+|the \w+|a \w+)[.! ]*$")
# Not alone with it.
_REACHED = re.compile(r"^(?:ok(?:ay)?|yes|thanks|thank you)?[,. ]*(?:i(?:'ve| have| just|'m| am|'ll)? ?(?:just )?(?:called|texted|talked to|spoke to|spoken to|told|reached out to|with|calling|going to (?:call|tell|talk to|text)|call|on the phone with) (?:a |the |my |someone|somebody|988)(?: ?[a-z]+){0,2}|my \w+(?:'s| is) (?:here|with me|coming|on (?:his|her|their) way)(?: with me| now)*)(?: now| today| already)?[.! ]*$")
_SOON = re.compile(r"^(?:yes|yeah|yep|maybe|probably|i think so|i do|i'm|no)?[ ,.]*(?:but )?(?:maybe |very |really |pretty )?(?:tonight|right now|now|today|soon|tomorrow|in (?:a (?:bit|minute|while|few)|an hour|\d+ minutes|ten minutes)|later(?: today| tonight)?|any minute)[.! ]*$")
_SAYS_YES = r"(?:yes+|yeah+|yep|y|yup|ya|yea|yh|yah|mhm+|mm+hm+|uh huh|si|sure|correct|right|exactly|definitely|absolutely|obviously|of course|i think so|i guess(?: so)?|i suppose(?: so)?|i believe so|kind ?of|kinda|sort of|maybe|probably|perhaps|sometimes|often|always|a (?:bit|little|lot)|true|that's (?:it|right|what i mean(?:t)?|me|true|exactly (?:it|right))|it (?:does|is|means that)|(?:it's )?(?:both|the first(?: one| part)?|the second(?: one| part)?|all of (?:it|that|them)|yes to both))"
_SAYS_SO = r"(?:i (?:do|am|have|did|feel (?:like that|that way)|think about it|want (?:that|to))|i'm|i've been|about me|it's (?:me|about me)|me|myself|hurting myself|not being here|not wanting to (?:be (?:alive|here)|live)|i don't want to be (?:here|alive)|being hurt|in danger|i'm in danger|hurt|unwell|that|someone is hurt|someone else|(?:it's |about )?my (?:son|daughter|husband|wife|mom|mum|dad|friend|partner|brother|sister|child|kid)(?: is)?)"
_HOW_OFTEN = r"(?:all the time|every (?:day|night)|sometimes|often|a lot|always|constantly|for (?:weeks|months|years|a while)|lately|these days|at night|right now|now|tonight|today|a bit|a little|really|honestly|please help|please|help|help me|i guess|i think|so much|not being here|hurting myself|hurt|unwell|in danger|and i (?:can't stop|don't know what to do))"
_YES = re.compile(rf"^(?:{_SAYS_YES}|{_SAYS_SO})(?:[,.! ]+(?:{_SAYS_YES}|{_SAYS_SO}|{_HOW_OFTEN}|and|but|i mean))*[.! ]*(?:[\U0001F300-\U0001FAFF☹❤️:()'(-]*)[.! ]*$")
# Meant, after too much of something: then it is not a body only.
_PURPOSE = re.compile(r"\b(?:on purpose|meant to|wanted to die|didn't want to wake|want to die|to end it|i wanted to|that was the point|not an accident|wasn't an accident|deliberate\w*)\b")
_WORSE = re.compile(r"\b(?:all of them|the whole (?:bottle|pack|box)|(?:a lot|too many|\d+|ten|twenty|thirty|twelve|fifteen) of them|a lot|about (?:\d+|ten|twenty|thirty)|\d{2,}|sleepy|drowsy|dizzy|sick|faint\w*|shaky|shaking|can't (?:stay awake|see|stand|breathe)|throwing up|vomit\w*|numb|confused|passing out|getting worse|alone|no one is here|by myself)\b")
_HOW_MUCH = re.compile(r"^(?:yes,? )?(?:(?:i )?(?:did|took|have|swallowed)\b.{0,30}|(?:about |around |maybe |like )?(?:\d+|ten|twelve|fifteen|twenty|thirty|forty|fifty|a lot|most of (?:them|it)|half(?: of (?:them|it))?)(?: of them)?|(?:about |like )?(?:an hour|half an hour|\d+ (?:minutes|mins|hours)|a (?:few|couple of) (?:minutes|hours)|just now|earlier|this morning|last night|tonight|today)(?: ago)?)[.! ]*$")
# The whole message, and nothing in it that says the opposite.
_ALL_RIGHT = (r"(?:(?:i'm|i am|it's|all|i feel|feeling|everything's|everything is|i'll be|i will be) ?(?:all )?(?:ok|okay|fine|good|safe|alright|all right|better|well)(?: (?:now|really|today|again|honestly|i promise|thanks|thank you|actually|though|for now))*"
              r"|(?:i(?:'m| am| was)|it was|that was)? ?(?:just |only )?(?:kidding|joking|a joke|messing around|being dramatic|venting)"
              r"|(?:i )?didn't mean (?:it|that)(?: like that| that way)?|i (?:just )?meant (?:my |the |this )?(?:diet|workout|plan|work|job|day|app|exercise)(?: plan)?"
              r"|(?:i'm )?not going to (?:do anything|hurt myself|act on it|do it)|i (?:promise i )?won't (?:do anything|hurt myself|do it)|(?:i have )?no plans?|i don't have a plan"
              r"|(?:a )?joke|don't worry about me|(?:not|no longer) suicidal|(?:i'm|i am) (?:not|no longer) (?:suicidal|in danger|thinking (?:of|about) (?:that|hurting myself))(?: (?:now|anymore|at all|really))*"
              r"|not at all|i'm not|nothing like that|(?:no )?to all of (?:that|it)|it (?:just )?means (?:things are|it's|life is) (?:\w+ )?hard|things are (?:just )?hard|it's (?:just|only) (?:work|stress|work stress|hard)|just (?:tired|stressed|work stress|hard)|something else|it's something else|neither|no)")
_FINE = re.compile(r"^(?:(?:no|nah|nope|sorry|oh|haha|lol|honestly|thanks|thank you|don't worry|yes|yeah|ok|okay)[,.! ]+)*" + _ALL_RIGHT + r"(?:(?:[,.!]+ ?(?:and |but )?| and | but )" + _ALL_RIGHT + r")*[.! ]*(?:, )?(?:thanks|thank you|lol|haha)?[.! ]*$")
_FINE_YES = re.compile(r"^(?:yes|yeah|ok|okay)[,.! ]+(?:i'm|i am|all|everything's) (?:safe|ok|okay|fine|good|all right|alright)(?: now| thanks)*[.! ]*$")
# A "no" that is not "I'm all right": to a request, or to the wrong question.
_JUST_NO = re.compile(r"^(?:no|nope|nah|no thanks|no thank you|not at all|not really|neither|i'm not|no i'm not|no not really)[.! ]*$")

_NOT_SAFE = re.compile(r"^(?:no|yes|honestly|and|but|i think)?[,. ]*i(?:'m| am| don't feel) (?:not |really not )?(?:safe|in danger)(?: (?:right now|tonight|here|at all|alone))*[.! ]*$")

FOLLOW_UP_FROM = RANK[UNSURE]


def _next(text: str, recent: str, answering: bool) -> Assessment | None:
    """What a message means because of the one before it, when it means nothing
    worrying by itself."""
    if RANK[recent] < FOLLOW_UP_FROM or not text:
        return None
    if recent == MEDICAL:                               # a body, not an intent
        if not answering:
            return None
        if _PURPOSE.search(text) and not re.search(r"\b(?:not|didn't|wasn't|never)\b[^.?!]{0,20}$", text[:_PURPOSE.search(text).start()]):
            return Assessment(IMMINENT)
        if (_YES.match(text) or _WORSE.search(text) or _REFUSES.match(text) or _HOW_MUCH.match(text) or re.search(r"\b(?:by accident|an accident|accidentally)\b", text)) and not _FINE.match(text):
            return Assessment(MEDICAL)
        return Assessment(steadier=True) if (_FINE.match(text) and not _JUST_NO.match(text)) or _REACHED.match(text) else None
    if _FOLLOWS.search(text) and recent != UNSURE:
        return Assessment(IMMINENT)
    if not answering:
        return None
    # "No" is an answer to a question, and only the first two ask one.
    if _JUST_NO.match(text):
        return Assessment(steadier=True) if recent in (UNSURE, CHECK_IN) else None
    if _FINE_YES.match(text) or _FINE.match(text) or _REACHED.match(text):
        return Assessment(steadier=True)
    if _SOON.match(text) or _NEXT.match(text) or _MEANS.match(text):
        return Assessment(IMMINENT)
    if _REFUSES.match(text):
        return Assessment(recent if RANK[recent] >= RANK[SELF_HARM] else SELF_HARM)
    if _YES.match(text):
        if recent == UNSURE and re.match(r"^(?:yes,? )?(?:i'm )?(?:in danger|being hurt)[.! ]*$", text):
            return Assessment(IMMINENT, harmed=True)
        somebody = re.search(r"\b(?:my (?:son|daughter|husband|wife|mom|mum|dad|friend|partner|brother|sister|child|kid)|someone (?:else|is hurt))\b", text)
        about = OTHER if somebody else SELF
        if recent == UNSURE and re.search(r"\b(?:unwell|someone is hurt|hurt)\b", text) and "hurting" not in text:
            return Assessment(MEDICAL, about=about)
        return Assessment(recent if RANK[recent] >= RANK[SELF_HARM] else SELF_HARM, about=about)
    return None


def assess(message: str, *, recent: str = NONE, answering: bool = True) -> Assessment:
    """`recent` is the most worrying thing this member said in the last day;
    `answering`, whether it was the message just before this one."""
    written = [_unnamed(text) for text in forms(message)]
    # The most worrying reading of it: one a person should know of, before one
    # that is only graver.
    worst = max((_read(text) for text in written), key=lambda a: (a.hand_over, RANK[a.level], a.unsure))
    residual = kept = _aside(written[0]).kept
    if not worst.urgent:
        # About somebody who is gone, history, or themselves long ago and well
        # now: read already, and not for the topic gate to read again.
        for pattern in (_SUBJECT_WORDS, *(_SELF_HARM if worst.steadier else ())):
            residual = pattern.sub(" ~ ", residual)
    # Words nothing was taken out of are passed on exactly as they were typed.
    residual = " ".join(residual.split()) if "~" in residual else normalise(message)
    if worst.harmed and answering and RANK[recent] >= RANK[UNSURE] and recent != MEDICAL and _NOT_SAFE.search(written[0]):
        worst = Assessment(IMMINENT)
    if not worst.urgent:
        said = _next(written[0], recent, answering)
        if said is not None:
            return replace(said, residual=residual)
    unsure = worst.unsure or (not (worst.urgent or worst.past or worst.steadier) and second_reading.worried(kept))
    return replace(worst, steadier=False, residual=residual, unsure=unsure)
