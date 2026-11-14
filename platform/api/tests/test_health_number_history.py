from app.assessments.service import CALCULATION_VERSION


def answer_data(**overrides):
    values = {
        "goals": ["Live a Healthier Lifestyle"], "plans": ["No other plans"],
        "activity": "Moderate (I exercise 1-3 times a week)", "meditate": "yes",
        "tired": "no", "gainWeight": "no", "abdomenWeight": "no",
        "sleepEnough": "yes", "sleepWell": "yes", "sleepHours": 7,
        "diet": "No preference", "source": "Friends or Family",
    }
    values.update(overrides)
    return values


def test_history_returns_empty_for_a_new_member(member_client):
    body = member_client.get("/api/v1/members/me/health-number").json()
    assert body["latest"] is None
    assert body["history"] == []


def test_history_returns_latest_first_and_keeps_the_stored_version(member_client):
    first = member_client.post("/api/v1/health-number/calculate", json={"answers": answer_data()}).json()
    second = member_client.post("/api/v1/health-number/calculate", json={"answers": answer_data(tired="yes")}).json()
    body = member_client.get("/api/v1/members/me/health-number").json()

    assert body["latest"]["attempt_id"] == second["attempt_id"]
    assert [row["attempt_id"] for row in body["history"]] == [second["attempt_id"], first["attempt_id"]]
    assert all(row["calculation_version"] == CALCULATION_VERSION for row in body["history"])
    assert body["latest"]["displayed_score"] == second["displayed_score"]
    assert {"status", "bucket", "category", "interpretation", "completed_at"} <= set(body["latest"])


def test_a_dashboard_retake_without_the_referral_question_is_kept_with_the_rest(member_client):
    """The dashboard retake does not ask how the member found Veye (client,
    20 Aug 2026). Its result is a dated entry like any other."""
    first = member_client.post("/api/v1/health-number/calculate", json={"answers": answer_data()})
    retake_answers = answer_data(tired="yes")
    del retake_answers["source"]
    retake = member_client.post("/api/v1/health-number/calculate", json={"answers": retake_answers})
    assert first.status_code == 201 and retake.status_code == 201, retake.text
    body = member_client.get("/api/v1/members/me/health-number").json()
    assert [row["attempt_id"] for row in body["history"]] == [retake.json()["attempt_id"], first.json()["attempt_id"]]
    # the same answers with a referral source score exactly the same
    with_source = member_client.post("/api/v1/health-number/calculate", json={"answers": answer_data(tired="yes")}).json()
    assert with_source["displayed_score"] == retake.json()["displayed_score"]
    assert with_source["points"] == retake.json()["points"]
