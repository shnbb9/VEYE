"""A member never reads a redaction mark, and Sprout's earlier replies go back
to the model as it wrote them.

Found by the first live run (26 Nov 2026): Sprout's replies are kept with the
member's first name filled in. Sent back as history, the outbound filter
rightly replaced the name with a mark, and a real model copied the mark into
its next greeting: "Hello [REDACTED:identifier]". The mock never copies, which
is why nothing here caught it before."""

from __future__ import annotations

from dataclasses import replace

from app.companion.personalization import MEMBER_FIRST_NAME_TOKEN, as_written, without_marks
from app.companion.prompt import RULES
from app.companion.providers.llm import MockLLMProvider
from app.core.runtime import configure_runtime, get_runtime
from tests.test_companion_pipeline import aditya, memory_traces  # noqa: F401  (fixtures)

MESSAGES = "/api/v1/companion/messages"
QUESTION = "Explain what my Health Number means in plain language"


def test_sprouts_earlier_replies_go_back_with_the_token_and_never_a_mark(aditya):  # noqa: F811
    first = aditya.post(MESSAGES, json={"message": QUESTION})
    assert first.status_code == 201, first.text
    assert first.json()["reply"].startswith("Hey Aditya,"), "the member still reads their name"
    second = aditya.post(MESSAGES, json={"message": "Is a lower Health Number better?", "conversation_id": first.json()["conversation_id"]})
    assert second.status_code == 201, second.text

    request = get_runtime().llm.last_request
    earlier = [m.content for m in request.messages if m.role == "assistant"]
    assert earlier and earlier[0].startswith(f"Hey {MEMBER_FIRST_NAME_TOKEN},"), earlier
    turns = " ".join(m.content for m in request.messages)
    assert "[REDACTED" not in turns, "the model was shown a mark where its own token had been"
    assert "Aditya" not in request.system + turns, "nor the name"
    assert second.json()["reply"].startswith("Hey Aditya,")


class Copies(MockLLMProvider):
    """A model that writes back the marks it was shown, as a real one did."""

    def complete(self, request):
        response = super().complete(request)
        return replace(response, text="Hello [REDACTED:identifier], we never see [REDACTED:email] or [REDACTED]. "
                                      "Your Health Number runs from 1 to 10; a lower number is better.")


def test_a_mark_the_model_writes_never_reaches_the_member(aditya):  # noqa: F811
    configure_runtime(llm=Copies())
    response = aditya.post(MESSAGES, json={"message": QUESTION})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["reply"] == ("Hello Aditya, we never see your email address or that detail. "
                             "Your Health Number runs from 1 to 10; a lower number is better.")
    kept = aditya.get("/api/v1/companion/session").json()["conversation"]["messages"]
    assert not any("[REDACTED" in m["content"] for m in kept), "nor what is kept and shown again"


def test_the_prompt_asks_the_model_never_to_write_a_mark():
    assert "[REDACTED:identifier]" in RULES and "never write one" in RULES


def test_as_written_puts_back_only_the_name_that_was_filled_in():
    token = MEMBER_FIRST_NAME_TOKEN
    assert as_written("Hey Aditya, lower is better, Aditya.", "Aditya") == f"Hey {token}, lower is better, {token}."
    assert as_written("Hey May, you may like Mayfair.", "May") == f"Hey {token}, you may like Mayfair.", "exact case, whole words"
    assert as_written("Hey Al, a meal.", "Al") == f"Hey {token}, a meal."
    assert as_written("Hey A, a meal.", "A") == "Hey A, a meal.", "too short to be a name the filter would take"
    assert as_written("Hey there.", None) == "Hey there."


def test_without_marks_turns_every_mark_into_words():
    text, count = without_marks("[REDACTED:identifier] [REDACTED:email] [REDACTED:phone] [REDACTED:id] [REDACTED:number] "
                                "[REDACTED] [REDACTED:something_new] [redacted] [REDACTED:Email]")
    assert text == (f"{MEMBER_FIRST_NAME_TOKEN} your email address your phone number that number that number "
                    "that detail that detail [redacted] [REDACTED:Email]")
    assert count == 7
    assert without_marks("Nothing to see.") == ("Nothing to see.", 0)
