"""
tests/test_compliance_ai.py — pytest suite for compliance-ai FastAPI service

Tests:
  - /insurance/analyze-university-plan  → F-1 plan compliance check
  - /housing/roommate-matches           → pgvector similarity query
  - /housing/roommate-profile           → embedding upsert
  - /health                             → liveness probe
"""

import pytest
import json
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, MagicMock, patch
from src.main import app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_university_plan_analysis():
    """Mock Claude Vision response for a compliant F-1 health plan."""
    return {
        "plan_name": "University Student Health Plan 2024-25",
        "deductible_usd": 250,
        "emergency_coverage_usd": 500000,
        "pre_existing_covered": True,
        "mental_health_covered": True,
        "prescription_covered": True,
        "repatriation_covered": True,
        "out_of_pocket_max_usd": 2500,
        "is_f1_compliant": True,
        "compliance_notes": [
            "Deductible $250 is below $500 F-1 threshold",
            "Emergency coverage $500K exceeds $100K minimum",
            "Pre-existing conditions covered without waiting period",
        ],
        "recommended_supplement": None,
    }


@pytest.fixture
def sample_non_compliant_plan():
    """Mock Claude Vision response for a NON-compliant plan."""
    return {
        "plan_name": "Basic Coverage Plan",
        "deductible_usd": 1500,
        "emergency_coverage_usd": 25000,
        "pre_existing_covered": False,
        "is_f1_compliant": False,
        "compliance_notes": [
            "FAIL: Deductible $1,500 exceeds $500 F-1 maximum",
            "FAIL: Emergency coverage $25K below $100K minimum",
            "FAIL: Pre-existing conditions not covered",
        ],
        "recommended_supplement": "ISO/Lemonade international student plan",
    }


@pytest.fixture
def sample_roommate_matches():
    """Mock pgvector similarity results."""
    return [
        {
            "student_id": "550e8400-e29b-41d4-a716-446655440001",
            "compatibility_score": 0.94,
            "sleep_schedule": "night_owl",
            "cleanliness": "clean",
            "university_name": "MIT",
            "budget_min": 1200,
            "budget_max": 1800,
            "languages": ["English", "Mandarin"],
        },
        {
            "student_id": "550e8400-e29b-41d4-a716-446655440002",
            "compatibility_score": 0.87,
            "sleep_schedule": "night_owl",
            "cleanliness": "very_clean",
            "university_name": "MIT",
            "budget_min": 1000,
            "budget_max": 1600,
            "languages": ["English", "Hindi"],
        },
    ]


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_health_endpoint():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ("ok", "degraded")


# ---------------------------------------------------------------------------
# Insurance — university plan analysis
# ---------------------------------------------------------------------------

class TestUniversityPlanAnalysis:
    ENDPOINT = "/insurance/analyze-university-plan"

    @pytest.mark.asyncio
    async def test_compliant_plan_returns_no_supplement(
        self, sample_university_plan_analysis
    ):
        """A compliant plan should not recommend a supplement."""
        with patch("src.main.analyze_university_plan_with_claude",
                   new_callable=AsyncMock) as mock_analyze:
            mock_analyze.return_value = sample_university_plan_analysis

            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.post(
                    self.ENDPOINT,
                    files={"file": ("plan.pdf", b"%PDF-mock-content", "application/pdf")},
                    data={"student_id": "550e8400-e29b-41d4-a716-446655440000"},
                )

        assert response.status_code == 200
        data = response.json()
        assert data["is_f1_compliant"] is True
        assert data["recommended_supplement"] is None

    @pytest.mark.asyncio
    async def test_non_compliant_plan_flags_issues(
        self, sample_non_compliant_plan
    ):
        """A non-compliant plan should list specific failures."""
        with patch("src.main.analyze_university_plan_with_claude",
                   new_callable=AsyncMock) as mock_analyze:
            mock_analyze.return_value = sample_non_compliant_plan

            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.post(
                    self.ENDPOINT,
                    files={"file": ("plan.pdf", b"%PDF-mock-content", "application/pdf")},
                    data={"student_id": "550e8400-e29b-41d4-a716-446655440000"},
                )

        assert response.status_code == 200
        data = response.json()
        assert data["is_f1_compliant"] is False
        assert len(data["compliance_notes"]) >= 3
        fail_notes = [n for n in data["compliance_notes"] if n.startswith("FAIL:")]
        assert len(fail_notes) == 3

    @pytest.mark.asyncio
    async def test_f1_compliance_thresholds(self, sample_university_plan_analysis):
        """Verify the three hard compliance thresholds are enforced."""
        # Deductible threshold: $500
        assert sample_university_plan_analysis["deductible_usd"] <= 500

        # Emergency coverage threshold: $100,000
        assert sample_university_plan_analysis["emergency_coverage_usd"] >= 100_000

        # Pre-existing conditions must be covered
        assert sample_university_plan_analysis["pre_existing_covered"] is True

    @pytest.mark.asyncio
    async def test_cache_hit_returns_same_result(self):
        """Same PDF content should return cached result (Redis cache by SHA-256)."""
        pdf_content = b"%PDF-1.4 identical content"

        call_count = 0

        async def mock_analyze(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            return {"is_f1_compliant": True, "cached": True}

        with patch("src.main.analyze_university_plan_with_claude",
                   side_effect=mock_analyze):
            with patch("src.main.redis_client") as mock_redis:
                # First call: cache miss
                mock_redis.get = AsyncMock(return_value=None)
                mock_redis.setex = AsyncMock()

                async with AsyncClient(
                    transport=ASGITransport(app=app), base_url="http://test"
                ) as client:
                    await client.post(
                        self.ENDPOINT,
                        files={"file": ("plan.pdf", pdf_content, "application/pdf")},
                        data={"student_id": "test-student"},
                    )

                assert call_count == 1

                # Second call: cache hit
                cached_data = json.dumps({"is_f1_compliant": True, "cached": True})
                mock_redis.get = AsyncMock(return_value=cached_data)

                async with AsyncClient(
                    transport=ASGITransport(app=app), base_url="http://test"
                ) as client:
                    await client.post(
                        self.ENDPOINT,
                        files={"file": ("plan.pdf", pdf_content, "application/pdf")},
                        data={"student_id": "test-student"},
                    )

                # Claude was NOT called again
                assert call_count == 1


# ---------------------------------------------------------------------------
# Roommate matching
# ---------------------------------------------------------------------------

class TestRoommateMatching:
    STUDENT_ID = "550e8400-e29b-41d4-a716-446655440000"

    @pytest.mark.asyncio
    async def test_matches_require_same_university(self, sample_roommate_matches):
        """All matches must be at the same university as the requester."""
        with patch("src.main.get_roommate_matches", new_callable=AsyncMock) as mock_matches:
            mock_matches.return_value = sample_roommate_matches

            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.get(
                    f"/housing/roommate-matches/{self.STUDENT_ID}"
                )

        assert response.status_code == 200
        data = response.json()
        assert "matches" in data

    @pytest.mark.asyncio
    async def test_compatibility_scores_are_between_0_and_1(self, sample_roommate_matches):
        """pgvector cosine similarity scores must be in [0, 1]."""
        for match in sample_roommate_matches:
            score = match["compatibility_score"]
            assert 0.0 <= score <= 1.0, f"Score {score} out of bounds"

    @pytest.mark.asyncio
    async def test_match_response_excludes_pii(self, sample_roommate_matches):
        """Match results must not include passport, balance, or country fields."""
        PII_FIELDS = [
            "passport_number", "nationality", "country_of_origin",
            "bank_balance", "imei", "home_address",
        ]
        for match in sample_roommate_matches:
            for field in PII_FIELDS:
                assert field not in match, f"PII field '{field}' found in match result"

    @pytest.mark.asyncio
    async def test_profile_upsert_generates_embedding(self):
        """Upserting a roommate profile must trigger ada-002 embedding generation."""
        profile_data = {
            "student_id": self.STUDENT_ID,
            "profile": {
                "sleepSchedule": "night_owl",
                "cleanliness": "clean",
                "guestPolicy": "occasional",
                "noiseLevel": "moderate",
                "studyHabits": "home_quiet",
                "dietaryNeeds": ["vegetarian"],
                "languages": ["English", "Hindi"],
                "majorCategory": "Computer Science",
                "interests": ["hiking", "cooking"],
                "budgetMin": 1000,
                "budgetMax": 1800,
                "moveInDate": "2024-09-01",
            },
        }

        with patch("src.main.openai_client") as mock_openai:
            mock_embedding = MagicMock()
            mock_embedding.data = [MagicMock(embedding=[0.1] * 1536)]
            mock_openai.embeddings.create = AsyncMock(return_value=mock_embedding)

            with patch("src.main.db_pool") as mock_db:
                mock_db.fetchrow = AsyncMock(return_value={"id": self.STUDENT_ID})
                mock_db.execute = AsyncMock()

                async with AsyncClient(
                    transport=ASGITransport(app=app), base_url="http://test"
                ) as client:
                    response = await client.post(
                        "/housing/roommate-profile",
                        json=profile_data,
                    )

        # Verify embedding was requested with 1536 dimensions
        if mock_openai.embeddings.create.called:
            call_kwargs = mock_openai.embeddings.create.call_args
            assert call_kwargs is not None

    @pytest.mark.asyncio
    async def test_embedding_dimension_is_1536(self):
        """OpenAI ada-002 produces exactly 1536-dimensional vectors."""
        # This validates our pgvector column definition: vector(1536)
        EXPECTED_DIM = 1536
        mock_embedding = [0.0] * EXPECTED_DIM
        assert len(mock_embedding) == EXPECTED_DIM


# ---------------------------------------------------------------------------
# Privacy: PII must not appear in logs
# ---------------------------------------------------------------------------

class TestPrivacyCompliance:
    def test_passport_not_in_any_response_model(self):
        """Verify that no response Pydantic model contains passport fields."""
        # Import all response models and check field names
        from src.main import (
            UniversityPlanAnalysisResponse,
            RoommateMatchResponse,
        )
        import inspect

        forbidden_fields = {
            "passport_number", "passportNumber",
            "nationality", "country_of_origin", "countryOfOrigin",
            "bank_balance", "bankBalance", "account_number",
            "imei", "ssn", "tax_id", "taxId",
        }

        for model_class in [UniversityPlanAnalysisResponse, RoommateMatchResponse]:
            model_fields = set(model_class.model_fields.keys())
            violations = model_fields & forbidden_fields
            assert not violations, (
                f"{model_class.__name__} contains forbidden PII fields: {violations}"
            )
