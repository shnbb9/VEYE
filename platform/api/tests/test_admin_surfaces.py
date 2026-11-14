"""Admin Companion API: knowledge-source lifecycle with real persistence,
settings, feedback review and the Advanced monitoring surfaces."""

from app.seed.knowledge import seed_knowledge
from tests.conftest import sign_up


def _source_payload(**overrides):
    payload = {"title": "Sleep and evening routine", "type": "VEYE educational document", "scope_key": "help",
               "description": "Synthetic note about the evening wind-down.", "reference_label": "sleep-note.md"}
    payload.update(overrides)
    return payload


def test_knowledge_source_lifecycle_via_admin_api(admin_client):
    options = admin_client.get("/api/v1/admin/companion/knowledge-sources/options").json()
    assert "health_number" in options["scopes"] and "Archived" in options["statuses"]

    created = admin_client.post("/api/v1/admin/companion/knowledge-sources", json=_source_payload())
    assert created.status_code == 201, created.text
    source = created.json()
    assert source["status"] == "Draft" and source["retrievable"] is False and source["storage"] == "local-file"
    sid = source["id"]

    # Activation before ingestion is refused.
    refused = admin_client.post(f"/api/v1/admin/companion/knowledge-sources/{sid}/activate")
    assert refused.status_code == 409

    edited = admin_client.put(f"/api/v1/admin/companion/knowledge-sources/{sid}", json=_source_payload(title="Evening routine"))
    assert edited.status_code == 200 and edited.json()["title"] == "Evening routine"

    bad = admin_client.post(f"/api/v1/admin/companion/knowledge-sources/{sid}/document",
                            files={"file": ("guide.pdf", b"%PDF-1.4 fake", "application/pdf")})
    assert bad.status_code == 201 and bad.json()["current_document"]["ingestion_status"] == "failed"

    attached = admin_client.post(f"/api/v1/admin/companion/knowledge-sources/{sid}/document",
                                 files={"file": ("sleep-note.md", b"# Evening routine\n\nLights low, no screens, herbal tea before bed.\n", "text/markdown")})
    assert attached.status_code == 201
    doc = attached.json()["current_document"]
    assert doc["ingestion_status"] == "ingested" and doc["chunk_count"] == 1 and attached.json()["version"] == 2

    active = admin_client.post(f"/api/v1/admin/companion/knowledge-sources/{sid}/activate").json()
    assert active["status"] == "Active" and active["approved_by"] == "Cara Hogue" and active["retrievable"] is True

    hits = admin_client.post("/api/v1/admin/companion/advanced/retrieval-diagnostics/query", json={"query": "evening herbal tea before bed"}).json()
    assert hits and hits[0]["title"] == "Evening routine" and hits[0]["source_version"] == 2

    inactive = admin_client.post(f"/api/v1/admin/companion/knowledge-sources/{sid}/deactivate").json()
    assert inactive["status"] == "Inactive" and inactive["retrievable"] is False
    assert admin_client.post("/api/v1/admin/companion/advanced/retrieval-diagnostics/query", json={"query": "evening herbal tea before bed"}).json() == []

    archived = admin_client.post(f"/api/v1/admin/companion/knowledge-sources/{sid}/archive").json()
    assert archived["status"] == "Archived" and archived["archived_at"]
    assert admin_client.put(f"/api/v1/admin/companion/knowledge-sources/{sid}", json=_source_payload()).status_code == 409
    restored = admin_client.post(f"/api/v1/admin/companion/knowledge-sources/{sid}/restore").json()
    assert restored["status"] == "Inactive" and restored["archived_at"] is None
    # History is retained: both document versions remain on the record.
    detail = admin_client.get(f"/api/v1/admin/companion/knowledge-sources/{sid}").json()
    assert len(detail["documents"]) == 2 and sum(d["is_current"] for d in detail["documents"]) == 1

    actions = [entry["action"] for entry in admin_client.get("/api/v1/admin/companion/advanced/audit").json()["rows"]]
    for expected in ("knowledge_source.created", "knowledge_source.updated", "knowledge_document.attached", "knowledge_source.activated",
                     "knowledge_source.deactivated", "knowledge_source.archived", "knowledge_source.restored"):
        assert expected in actions


def test_members_cannot_reach_admin_knowledge_or_advanced_routes(client):
    # A member-portal session is no admin session: the console answers 401
    # (not signed in to the admin portal), never 403 with a hint of who they are.
    sign_up(client)
    assert client.get("/api/v1/admin/companion/knowledge-sources").status_code == 401
    assert client.get("/api/v1/admin/companion/advanced/provider-status").status_code == 401
    assert client.get("/api/v1/admin/companion/settings").status_code == 401
    client.cookies.clear()
    assert client.get("/api/v1/admin/companion/knowledge-sources").status_code == 401


def test_advanced_surfaces_report_without_secrets(client, admin_client):
    seed_knowledge()
    sign_up(client)
    client.post("/api/v1/companion/messages", json={"message": "Explain what my Health Number means"})
    reply = client.post("/api/v1/companion/messages", json={"message": "How much EPA should I take?"}).json()
    assert reply["outcome"] == "prohibited"

    monitoring = admin_client.get("/api/v1/admin/companion/advanced/ai-monitoring").json()
    assert monitoring["traces"] == 2 and monitoring["answered"] == 1 and monitoring["by_provider"] == {"mock": 1}
    assert monitoring["by_outcome"] == {"allow": 1, "prohibit": 1} and monitoring["langfuse_status"] == "disabled"
    recent = monitoring["recent"]
    assert len(recent) == 2, monitoring
    assert all(len(r["member_ref"]) == 16 for r in recent), recent
    assert all("Aditya" not in str(r) for r in recent), recent

    retrieval = admin_client.get("/api/v1/admin/companion/advanced/retrieval-diagnostics").json()
    assert retrieval["index"]["sources_retrievable"] == 3 and retrieval["index"]["chunks_total"] > 0
    assert retrieval["average_top_score"] is not None

    safety = admin_client.get("/api/v1/admin/companion/advanced/safety-analytics").json()
    assert safety["decisions_by_outcome"] == {"allow": 1, "prohibit": 1} and safety["policy_version"] == "1.0.0"

    status = admin_client.get("/api/v1/admin/companion/advanced/provider-status").json()
    assert status["llm"]["provider"] == "mock" and status["email"]["provider"] == "memory"
    assert status["langfuse"]["status"] == "disabled" and status["langfuse"]["keys_present"] is False
    assert status["object_store"]["provider"] == "local-file"
    flat = str(status).lower()
    assert "secret" not in flat and "api_key" not in flat and "password" not in flat

    overview = admin_client.get("/api/v1/admin/companion/overview").json()
    assert overview["conversations_total"] == 1 and overview["knowledge_sources_active"] == 3

    feedback = client.post(f"/api/v1/companion/messages/{reply['reply_message_id']}/feedback", json={"rating": "helpful"})
    assert feedback.status_code == 200
    rows = admin_client.get("/api/v1/admin/companion/feedback?filter=unreviewed").json()
    assert len(rows) == 1 and rows[0]["rating"] == "helpful" and rows[0]["member_name"] == "Aditya Demo"
    reviewed = admin_client.post(f"/api/v1/admin/companion/feedback/{rows[0]['id']}/review").json()
    assert reviewed["reviewed_by"] == "Cara Hogue"
    assert admin_client.get("/api/v1/admin/companion/feedback?filter=unreviewed").json() == []


def test_an_administrator_uploads_a_word_document_and_a_member_can_be_answered_from_it(admin_client, member_client):
    """The whole point of the knowledge base, end to end.

    Until Word and PDF were readable, none of the client's actual source
    material could be loaded at all: her documents are .docx. This walks the
    real path — an administrator attaches a Word file, approves it, and the
    passage reaches a member's Companion answer as a cited source.
    """
    from tests.test_knowledge_extraction import DOCX_TYPE, make_docx

    created = admin_client.post("/api/v1/admin/companion/knowledge-sources",
                                json=_source_payload(title="Olive oil in cooking"))
    sid = created.json()["id"]

    document = make_docx([
        "Olive oil in cooking",
        "",
        "When a protein is cooked, the fat to cook it in is light olive oil.",
        "Olive oil can also be used to saute the carbohydrates.",
    ], table=[["Fat", "Amount"], ["Olive oil (extra light for cooking)", "1 tsp"]])

    attached = admin_client.post(
        f"/api/v1/admin/companion/knowledge-sources/{sid}/document",
        files={"file": ("Olive oil.docx", document, DOCX_TYPE)})
    assert attached.status_code == 201, attached.text
    doc = attached.json()["current_document"]
    assert doc["ingestion_status"] == "ingested", doc.get("ingestion_error")
    assert doc["chunk_count"] >= 1
    # The note is not an error, and says what the reader left behind.
    assert doc["ingestion_error"] is None
    assert "Word document" in doc["extraction_note"] and "table(s) read in place" in doc["extraction_note"]

    assert admin_client.post(f"/api/v1/admin/companion/knowledge-sources/{sid}/activate").json()["retrievable"] is True

    hits = admin_client.post("/api/v1/admin/companion/advanced/retrieval-diagnostics/query",
                             json={"query": "what fat should I cook the protein in"}).json()
    assert any(h["title"] == "Olive oil in cooking" for h in hits), hits

    # And the member's own side: the passage is offered to the Companion and
    # comes back as a cited source, not as something the model recalled.
    answered = member_client.post("/api/v1/companion/messages",
                                  json={"message": "what fat should I cook the protein in?"})
    assert answered.status_code == 201, answered.text
    titles = [s["title"] for s in answered.json()["sources"]]
    assert "Olive oil in cooking" in titles, answered.json()


def test_a_pdf_an_administrator_uploads_is_read_page_by_page(admin_client):
    from tests.test_knowledge_extraction import make_pdf

    created = admin_client.post("/api/v1/admin/companion/knowledge-sources",
                                json=_source_payload(title="Breakfast timing"))
    sid = created.json()["id"]
    attached = admin_client.post(
        f"/api/v1/admin/companion/knowledge-sources/{sid}/document",
        files={"file": ("Timing.pdf", make_pdf(["Eat within an hour of getting up."]),
                        "application/pdf")})
    doc = attached.json()["current_document"]
    assert doc["ingestion_status"] == "ingested", doc.get("ingestion_error")
    assert "PDF: 1 of 1 page(s)" in doc["extraction_note"]


def test_a_scanned_document_fails_loudly_rather_than_indexing_nothing(admin_client):
    """A source that reports success while holding no text is how an
    administrator comes to believe content is loaded when it is not."""
    from tests.test_knowledge_extraction import DOCX_TYPE, make_docx

    created = admin_client.post("/api/v1/admin/companion/knowledge-sources",
                                json=_source_payload(title="A scan"))
    sid = created.json()["id"]
    attached = admin_client.post(
        f"/api/v1/admin/companion/knowledge-sources/{sid}/document",
        files={"file": ("Scan.docx", make_docx([], with_image=True), DOCX_TYPE)})
    doc = attached.json()["current_document"]
    assert doc["ingestion_status"] == "failed"
    assert "OCR" in doc["ingestion_error"]
    assert doc["extraction_note"] is None
    # And it cannot be approved while it holds nothing.
    assert admin_client.post(f"/api/v1/admin/companion/knowledge-sources/{sid}/activate").status_code == 409


def test_audit_log_is_paged_and_reports_the_whole_total(admin_client):
    """The window must never be mistakable for the whole log.

    The console rendered the most recent hundred entries with nothing on screen
    to say a hundred was a cap, so an administrator who could not find an older
    action had no way to tell the list was short. The response now carries the
    total, and a second page returns different rows rather than repeating the
    first — these entries share a timestamp to the second, so the ordering needs
    a tiebreaker or an offset silently re-serves rows it has already sent.
    """
    for n in range(5):
        admin_client.post("/api/v1/admin/companion/knowledge-sources", json=_source_payload(title=f"Paging note {n}"))

    first = admin_client.get("/api/v1/admin/companion/advanced/audit", params={"limit": 2}).json()
    assert first["page"] == 1 and first["page_size"] == 2 and len(first["rows"]) == 2
    assert first["total"] >= 5, "the total counts the whole log, not the window"
    assert first["total"] > len(first["rows"]), "this fixture must produce more rows than one page"

    second = admin_client.get("/api/v1/admin/companion/advanced/audit", params={"limit": 2, "page": 2}).json()
    assert second["page"] == 2 and second["total"] == first["total"]
    assert {r["id"] for r in second["rows"]}.isdisjoint({r["id"] for r in first["rows"]})

    # The last page is partial rather than refused, and past the end is empty.
    beyond = admin_client.get("/api/v1/admin/companion/advanced/audit",
                              params={"limit": 2, "page": first["total"] // 2 + 5}).json()
    assert beyond["rows"] == [] and beyond["total"] == first["total"]


def test_feedback_excerpt_marks_a_reply_it_has_cut():
    """A reviewer must be able to tell a short reply from a shortened one.

    The Feedback table shows the first 160 characters of what Sprout said. It
    used to be a bare slice: no ellipsis, and a word could be cut in half, so a
    truncated reply read as a reply that simply stopped there — on the one
    screen whose purpose is judging whether the reply was good.
    """
    from app.admin.companion_routes import EXCERPT_CHARS, _reply_excerpt

    class _Message:
        def __init__(self, content): self.content = content

    short = "A Health Number of 1 means good health."
    assert _reply_excerpt(_Message(short)) == short, "a reply that fits is passed through untouched"
    assert _reply_excerpt(None) == ""
    assert _reply_excerpt(_Message("")) == ""

    long = "word " * 200
    cut = _reply_excerpt(_Message(long))
    assert cut.endswith("…") and len(cut) <= EXCERPT_CHARS + 1
    assert not cut[:-1].endswith(" "), "no trailing space before the ellipsis"
    assert "wor…" not in cut, "the cut falls on a space, so no word is halved"

    # A single unbroken token has no space to fall back to, and is still marked.
    blob = "x" * 400
    assert _reply_excerpt(_Message(blob)) == "x" * EXCERPT_CHARS + "…"

    # Exactly at the boundary is not a truncation.
    exact = "y" * EXCERPT_CHARS
    assert _reply_excerpt(_Message(exact)) == exact and "…" not in _reply_excerpt(_Message(exact))
