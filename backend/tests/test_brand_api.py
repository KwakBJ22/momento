"""Tests for brand generation API."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.brand.engine import BrandResult
from app.main import fastapi_app

client = TestClient(fastapi_app)


def test_generate_endpoint_returns_results():
    mock_results = [
        BrandResult(
            brand="Kevora",
            score=95,
            domain=True,
            pronunciation="케보라",
            reason="짧고 기억하기 쉬우며 .com 도메인 등록에 적합합니다.",
        )
    ]

    with patch("app.api.brand.get_brand_engine") as mock_engine:
        engine = mock_engine.return_value
        engine.generate = AsyncMock(return_value=mock_results)

        response = client.post("/api/generate", json={"description": "가족 사진 앨범"})

    assert response.status_code == 200
    body = response.json()
    assert len(body["results"]) == 1
    assert body["results"][0]["brand"] == "Kevora"
    assert body["results"][0]["score"] == 95
    assert body["results"][0]["domain"] is True


def test_generate_rejects_empty_description():
    response = client.post("/api/generate", json={"description": ""})
    assert response.status_code == 422
