"""The words a visitor reads before choosing to save their result.

ENGINEERING DRAFT, pending owner and legal approval (architecture V2 §11,
decision 1). The retention setting defaults to Never, so this notice is shown
to nobody until an administrator switches saving on — and the console says,
beside that switch, that this wording is still a draft.

The notice is versioned and hashed. The browser echoes both back when it
saves, and a save whose words do not match the current notice is refused: what
the record says the visitor agreed to has to be what was on their screen.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from app.prospects.retention import RetentionPolicy

NOTICE_VERSION = "prospect-capture-2026-11-14-draft-v1"
PRIVACY_PATH = "/privacy"

NOTICE_TEMPLATE = (
    "We will save your quiz answers and Health Number so you can come back to them or add them to an "
    "account. If you do not sign up, we keep them {retention} and then delete them. We will email this "
    "address a link to confirm it is yours; we never email your answers or your number. "
    "See our Privacy Policy."
)
CONSENT_LABEL = ("I agree to Veye storing my assessment and contacting me about this result, "
                 "as described above.")
# What the visitor sees on the result screen when they did not tick the box.
NOT_SAVED_NOTE = "Not saved. Your answers stay in this browser tab only and are gone when you close it."


@dataclass(frozen=True)
class CaptureNotice:
    version: str
    text: str
    consent_label: str
    hash: str
    privacy_path: str = PRIVACY_PATH


def notice_for(policy: RetentionPolicy) -> CaptureNotice | None:
    """None while saving is switched off: there is nothing to agree to."""
    if not policy.saving_enabled:
        return None
    text = NOTICE_TEMPLATE.format(retention=policy.visitor_phrase)
    digest = hashlib.sha256("\n".join((NOTICE_VERSION, text, CONSENT_LABEL)).encode("utf-8")).hexdigest()
    return CaptureNotice(version=NOTICE_VERSION, text=text, consent_label=CONSENT_LABEL, hash=digest)
