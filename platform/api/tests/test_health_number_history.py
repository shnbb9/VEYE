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
