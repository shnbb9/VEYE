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

    actions = [entry["action"] for entry in admin_client.get("/api/v1/admin/companion/advanced/audit").json()]
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
