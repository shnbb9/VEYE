"""Email wording for the notification kinds that exist today. Passwords never
appear in any message; links carry single-use tokens only.

Two facts about the deployment reach every message from here rather than from
its caller: which environment really sent it, and whether a reply reaches a
person. See `Presentation` below."""

from dataclasses import dataclass
from html import escape


@dataclass(frozen=True)
class Rendered:
    subject: str
    text: str
    html: str


@dataclass(frozen=True)
class Presentation:
    """How Veye presents itself in email: the environment the message really
    came from, and whether a reply reaches anybody.

    Fixed for the life of the process and set once at start-up from settings,
    because it is deployment configuration rather than per-message content —
    no caller should have to pass it, and none does."""

    environment: str = "local"
    reply_to: str | None = None


PRODUCTION_ENVIRONMENTS = frozenset({"production", "prod"})
_presentation = Presentation()


def configure(*, environment: str, reply_to: str | None = None) -> None:
    """Called once by `build_runtime`. Tests that need other wording set it
    directly and restore it afterwards."""
    global _presentation
    _presentation = Presentation(environment=environment or "local", reply_to=(reply_to or None))


def presentation() -> Presentation:
    return _presentation


def _footer() -> str:
    """A real recipient must never be told their message came from a
    development environment, and a developer must always be told that it did."""
    brand = "Veye &mdash; Nutrition Reimagined."
    if _presentation.environment.lower() in PRODUCTION_ENVIRONMENTS:
        return brand
    return f"{brand} Sent from the Veye {escape(_presentation.environment)} environment &mdash; not a live message."


def _how_to_reach_us(support_email: str | None = None) -> str:
    """Where to write, truthfully.

    With a monitored Reply-To, replying works and is the simplest thing to
    offer. Without one the sender is a no-reply address, so inviting a reply
    would be a lie — the support address is offered instead. The fallback never
    points at the application, because some of these messages go to people who
    cannot sign in."""
    if _presentation.reply_to:
        return "Replying to this message reaches the Veye team."
    if support_email:
        return f"Write to {support_email} and the Veye team will pick it up."
    return "Write to the Veye team at the support address on the website."


def _wrap(title: str, paragraphs: list[str], button: tuple[str, str] | None = None) -> str:
    body = "".join(
        f'<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#2E4A1A">{p}</p>' for p in paragraphs
    )
    cta = ""
    if button:
        label, url = button
        cta = (
            f'<p style="margin:22px 0"><a href="{escape(url, quote=True)}" '
            f'style="background:#446514;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;'
            f'font-weight:600;display:inline-block">{escape(label)}</a></p>'
        )
    return (
        '<div style="font-family:Kumbh Sans,Arial,sans-serif;background:#FBF8F1;padding:32px">'
        '<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:32px">'
        f'<h1 style="margin:0 0 18px;font-size:24px;color:#2E4A1A">{escape(title)}</h1>{body}{cta}'
        f'<p style="margin:26px 0 0;font-size:13px;color:#7A8A6A">{_footer()}</p>'
        "</div></div>"
    )


def welcome(first_name: str, web_base_url: str) -> Rendered:
    name = escape(first_name)
    return Rendered(
        subject="Welcome to Veye",
        text=(
            f"Hi {first_name},\n\nWelcome to the Veye program. Your account is ready.\n\n"
            f"Open your dashboard: {web_base_url}/app\n\n"
            "If you have not verified your email yet, use the separate verification message we sent you.\n"
        ),
        html=_wrap(
            "Welcome to Veye",
            [f"Hi {name},", "Welcome to the Veye program. Your account is ready.",
             "If you have not verified your email yet, use the separate verification message we sent you."],
            ("Open your dashboard", f"{web_base_url}/app"),
        ),
    )


def email_verification(first_name: str, link: str, hours: int) -> Rendered:
    name = escape(first_name)
    return Rendered(
        subject="Verify your Veye email address",
        text=(
            f"Hi {first_name},\n\nPlease confirm this email address for your Veye account:\n{link}\n\n"
            f"The link works once and expires in {hours} hours. If you did not create a Veye account, ignore this message.\n"
        ),
        html=_wrap(
            "Verify your email address",
            [f"Hi {name},", "Please confirm this email address for your Veye account.",
             f"The link works once and expires in {hours} hours. If you did not create a Veye account, ignore this message."],
            ("Verify my email", link),
        ),
    )


def password_reset(first_name: str, link: str, minutes: int) -> Rendered:
    name = escape(first_name)
    return Rendered(
        subject="Reset your Veye password",
        text=(
            f"Hi {first_name},\n\nSomeone asked to reset the password for this Veye account. "
            f"Use this link to choose a new password:\n{link}\n\n"
            f"The link works once and expires in {minutes} minutes. If this was not you, ignore this message "
            "and your password stays unchanged.\n"
        ),
        html=_wrap(
            "Reset your password",
            [f"Hi {name},",
             "Someone asked to reset the password for this Veye account. Use the button below to choose a new password.",
             f"The link works once and expires in {minutes} minutes. If this was not you, ignore this message and your password stays unchanged."],
            ("Choose a new password", link),
        ),
    )


def admin_invitation(first_name: str, link: str, hours: int, invited_by: str) -> Rendered:
    """An invitation to the admin console. Administrator access is provisioned,
    never self-served, so this link is the only way in."""
    name = escape(first_name)
    inviter = escape(invited_by)
    return Rendered(
        subject="You have been invited to the Veye admin console",
        text=(
            f"Hi {first_name},\n\n{invited_by} has invited you to the Veye admin console. "
            f"Use this link to set your password and activate the account:\n{link}\n\n"
            f"The link works once and expires in {hours} hours. If you were not expecting this invitation, "
            "ignore this message and no account is activated.\n"
        ),
        html=_wrap(
            "You have been invited to the Veye admin console",
            [f"Hi {name},",
             f"{inviter} has invited you to the Veye admin console. Use the button below to set your password "
             "and activate the account.",
             f"The link works once and expires in {hours} hours. If you were not expecting this invitation, "
             "ignore this message and no account is activated."],
            ("Set my password", link),
        ),
    )


def email_change(first_name: str, link: str, hours: int, new_email: str) -> Rendered:
    """Sent to the NEW address: the change only takes effect when the person
    holding that mailbox uses the link."""
    name = escape(first_name)
    address = escape(new_email)
    return Rendered(
        subject="Confirm your new Veye email address",
        text=(
            f"Hi {first_name},\n\nSomeone asked to move a Veye account to this address ({new_email}). "
            f"Use this link to confirm it:\n{link}\n\n"
            f"The link works once and expires in {hours} hours. Until then the account keeps its current address. "
            "If this was not you, ignore this message.\n"
        ),
        html=_wrap(
            "Confirm your new email address",
            [f"Hi {name},",
             f"Someone asked to move a Veye account to this address ({address}). Use the button below to confirm it.",
             f"The link works once and expires in {hours} hours. Until then the account keeps its current address. "
             "If this was not you, ignore this message."],
            ("Confirm this address", link),
        ),
    )


def account_deactivated(first_name: str, support_email: str | None = None) -> Rendered:
    """Sent when an administrator switches an account off, so the person is
    never left guessing why they cannot sign in.

    They cannot use Contact Us inside the application any more, so the way
    back has to be an address rather than a screen."""
    name = escape(first_name)
    contact = _how_to_reach_us(support_email)
    return Rendered(
        subject="Your Veye account has been deactivated",
        text=(
            f"Hi {first_name},\n\nYour Veye account has been deactivated, so you will not be able to sign in. "
            f"Your saved results are kept.\n\nIf you think this was a mistake, let us know. {contact}\n"
        ),
        html=_wrap(
            "Your account has been deactivated",
            [f"Hi {name},",
             "Your Veye account has been deactivated, so you will not be able to sign in. Your saved results are kept.",
             f"If you think this was a mistake, let us know. {escape(contact)}"],
        ),
    )


def email_changed_notice(first_name: str, previous_email: str, new_email: str, support_email: str | None = None) -> Rendered:
    """Sent to the OLD address once a change has actually taken effect.

    The confirmation link only ever goes to the new address; this is the other
    half — the person who held the old mailbox is told what happened, in
    enough detail to recognise a change they did not make. The new address is
    given in full deliberately: if somebody else moved the account, that is
    the single most useful fact the real owner can have. No password, no link
    and no token is included, so the message is worth nothing to a thief."""
    name = escape(first_name)
    contact = _how_to_reach_us(support_email)
    return Rendered(
        subject="Your Veye sign-in email address was changed",
        text=(
            f"Hi {first_name},\n\nThe email address used to sign in to your Veye account has been changed "
            f"from {previous_email} to {new_email}. Sign-in now works with the new address only, and every "
            "device that was signed in has been signed out.\n\n"
            f"If you made this change, there is nothing to do. If you did not, act now — whoever made it can "
            f"reach your account. {contact}\n"
        ),
        html=_wrap(
            "Your sign-in email address was changed",
            [f"Hi {name},",
             f"The email address used to sign in to your Veye account has been changed from "
             f"{escape(previous_email)} to {escape(new_email)}. Sign-in now works with the new address only, "
             "and every device that was signed in has been signed out.",
             f"If you made this change, there is nothing to do. If you did not, act now &mdash; whoever made it "
             f"can reach your account. {escape(contact)}"],
        ),
    )

def request_reply(subject: str, body: str, support_email: str) -> Rendered:
    """An administrator's answer to a Contact Us message, Help question or
    Join Beta request.

    The administrator's words are sent as written and nothing is added to
    them. The framing only says what the message is and where to go next, and
    it only invites a reply when a monitored Reply-To is actually configured.

    There is deliberately no "Hi <name>," line: the administrator writes the
    whole answer, their own salutation included if they want one, and a
    template greeting stacked on a typed one reads like two people talking."""
    about = f" about \u201c{subject}\u201d" if subject else ""
    about_html = f" about &ldquo;{escape(subject)}&rdquo;" if subject else ""
    where = _how_to_reach_us(support_email)
    return Rendered(
        subject=f"Veye replied to your message{(': ' + subject) if subject else ''}"[:180],
        text=f"Thank you for writing to Veye{about}. Here is our reply:\n\n{body}\n\n{where}\n",
        html=_wrap(
            "Veye replied to your message",
            [f"Thank you for writing to Veye{about_html}. Here is our reply:",
             escape(body).replace("\n", "<br />"),
             escape(where)],
        ),
    )

def companion_escalation(first_name: str, category: str, admin_link: str) -> Rendered:
    """Placeholder escalation for the team. Deliberately carries no member
    identity and no message content — minimum necessary."""
    name = escape(first_name)
    return Rendered(
        subject="Veye Companion: a conversation needs a person",
        text=(
            f"Hi {first_name},\n\nSprout handed a member conversation to the team (category: {category}). "
            f"Open the admin console to review it:\n{admin_link}\n\nNo member details are included in this message.\n"
        ),
        html=_wrap(
            "A Companion conversation needs a person",
            [f"Hi {name},", f"Sprout handed a member conversation to the team (category: {escape(category)}).",
             "No member details are included in this message."],
            ("Open the admin console", admin_link),
        ),
    )
