"""Archiving a source stops it answering members, on the next request.

`test_knowledge_retrieval.py` proves `KnowledgeService.search` returns only
Active, approved sources. That is the service. This is the claim a member's
answer depends on: Sprout cites approved knowledge, so a source an
administrator has just taken out of service must not be cited by the very next
turn — not after a restart, not after a cache expires.

It is the same shape as the Health Data Sharing Permission rule, which is read
per request for exactly this reason, and it is the thing that would break if
retrieval ever cached its index or if a second code path reached the chunks
without going through `search`.

The source carries a phrase nothing else in the seed contains, so "did it
reach the member" is decidable from the answer itself rather than from the
source list alone.
"""

from __future__ import annotations

from app.db.session import SessionLocal
from app.knowledge.models import STATUS_ACTIVE

CANARY_PHRASE = "zzkkx-approved-passage-canary"
TITLE = "Withdrawal probe guide"
SCOPE = "health_number"
QUESTION = "What does a lower Health Number mean?"


def _make_active_source(tmp_path):
    """An Active, approved, ingested source whose text holds the canary.

    Built through the service with the runtime's own object store and
    embeddings, so the same index the member's turn reads is the one written.
    """
    from app.core.runtime import get_runtime
    from app.knowledge.service import KnowledgeService

    with SessionLocal() as db:
        runtime = get_runtime()
        service = KnowledgeService(db, runtime.object_store, runtime.embeddings)
        source = service.create_source(title=TITLE, type="VEYE educational document",
                                       scope_key=SCOPE, description="Withdrawal probe")
        body = "\n".join([
            "# Health Number",
            "",
            f"A lower Veye Health Number is better. {CANARY_PHRASE}.",
            "The scale runs from one to ten and a lower number means fewer markers",
            "are out of range.",
            "",
        ]).encode()
        service.attach_document(source, filename="probe.md", content_type="text/markdown", data=body)
        service.activate(source, approved_by="Cara Hogue")
        db.commit()
        assert source.status == STATUS_ACTIVE and source.retrievable, (source.status, source.retrievable)
        return str(source.id)


def _ask(member_client) -> dict:
    response = member_client.post("/api/v1/companion/messages", json={"message": QUESTION})
    assert response.status_code == 201, response.text
    return response.json()


def test_an_active_source_reaches_the_answer(member_client, tmp_path):
    """The positive control. Without it, the withdrawal test below would pass
    on a system that never retrieved anything at all."""
    source_id = _make_active_source(tmp_path)
    answer = _ask(member_client)
    cited = [s.get("source_id") for s in answer.get("sources", [])]
    assert source_id in cited, (
        f"the Active source was not cited at all, so this file cannot test withdrawal. cited={cited}"
    )


def test_archiving_a_source_stops_it_being_cited_on_the_very_next_turn(member_client, admin_client, tmp_path):
    source_id = _make_active_source(tmp_path)
    first = _ask(member_client)
    assert source_id in [s.get("source_id") for s in first.get("sources", [])], first.get("sources")

    archived = admin_client.post(f"/api/v1/admin/companion/knowledge-sources/{source_id}/archive")
    assert archived.status_code == 200, archived.text
    assert archived.json()["status"] == "Archived", archived.json()["status"]
    assert archived.json()["retrievable"] is False

    second = _ask(member_client)
    cited = [s.get("source_id") for s in second.get("sources", [])]
    assert source_id not in cited, (
        "an archived source was cited to a member on the request after it was archived — "
        "retrieval is reading a stale index"
    )
    assert CANARY_PHRASE not in second["reply"], (
        "the archived source's own words reached the member's answer"
    )


def test_deactivating_does_the_same(member_client, admin_client, tmp_path):
    """Deactivate is the reversible half of the same lifecycle, and a
    deactivated source is equally out of service."""
    source_id = _make_active_source(tmp_path)
    assert source_id in [s.get("source_id") for s in _ask(member_client).get("sources", [])]

    stopped = admin_client.post(f"/api/v1/admin/companion/knowledge-sources/{source_id}/deactivate")
    assert stopped.status_code == 200, stopped.text
    assert stopped.json()["retrievable"] is False

    answer = _ask(member_client)
    assert source_id not in [s.get("source_id") for s in answer.get("sources", [])]
    assert CANARY_PHRASE not in answer["reply"]

    # And restoring it brings it back, so the test is about the state and not
    # about the source having been destroyed.
    back = admin_client.post(f"/api/v1/admin/companion/knowledge-sources/{source_id}/activate")
    assert back.status_code == 200, back.text
    assert back.json()["retrievable"] is True
    assert source_id in [s.get("source_id") for s in _ask(member_client).get("sources", [])]
