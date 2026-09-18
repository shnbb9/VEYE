"""Email wording for the notification kinds that exist today. Passwords never
appear in any message; links carry single-use tokens only."""

from dataclasses import dataclass
from html import escape


@dataclass(frozen=True)
class Rendered:
    subject: str
    text: str
    html: str


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
        '<p style="margin:26px 0 0;font-size:13px;color:#7A8A6A">Veye &mdash; Nutrition Reimagined. '
        "This message was sent by the local development environment.</p>"
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
