from app.progress.body_composition.service import BODY_COMPOSITION_CALCULATION_VERSION


def woman(**overrides):
    value = {"sex": "Woman", "weight": 150, "height": 65, "abdomen": 30, "hips": 40}
    value.update(overrides)
    return value


def test_body_composition_history_is_empty_before_an_attempt(member_client):
    response = member_client.get("/api/v1/members/me/body-composition")
    assert response.status_code == 200
    assert response.json()["latest"] is None
    assert response.json()["history"] == []


def test_body_composition_persists_latest_first_and_keeps_version(member_client):
    first = member_client.post("/api/v1/body-composition/calculate", json={"input": woman()}).json()
    second = member_client.post("/api/v1/body-composition/calculate", json={"input": woman(weight=155)}).json()
    history = member_client.get("/api/v1/members/me/body-composition").json()

    assert history["latest"]["attempt_id"] == second["attempt_id"]
    assert [item["attempt_id"] for item in history["history"]] == [second["attempt_id"], first["attempt_id"]]
    assert all(item["calculation_version"] == BODY_COMPOSITION_CALCULATION_VERSION for item in history["history"])
    assert history["latest"]["body_fat_available"] is True


def test_unavailable_lookup_persists_bmi_without_inventing_body_fat(member_client):
    result = member_client.post(
        "/api/v1/body-composition/calculate",
        json={"input": woman(height=80)},
    ).json()
    history = member_client.get("/api/v1/members/me/body-composition").json()

    assert result["body_fat_available"] is False
    assert result["body_fat_percent"] is None
    assert result["bmi"] == 16.5
    assert result["unavailable_reason"] == "outside the client table"
    assert history["latest"]["attempt_id"] == result["attempt_id"]


def test_body_composition_rejects_invalid_or_wrong_sex_measurements(member_client):
    assert member_client.post("/api/v1/body-composition/calculate", json={"input": woman(weight=0)}).status_code == 422
    assert member_client.post(
        "/api/v1/body-composition/calculate",
        json={"input": {"sex": "Man", "weight": 200, "height": 70, "waist": 40, "wrist": 8, "hips": 40}},
    ).status_code == 422
