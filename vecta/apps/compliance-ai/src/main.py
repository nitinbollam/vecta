# apps/compliance-ai/src/main.py
# ─── Vecta Compliance AI — FastAPI Service ────────────────────────────────────
# Handles: AI Medical Waiver analysis, Insurance Orchestration, Roommate Matching

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Literal, Optional

import anthropic
import asyncpg
import redis.asyncio as aioredis
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from openai import AsyncOpenAI

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("vecta.compliance-ai")

# ─── Globals ──────────────────────────────────────────────────────────────────

db_pool: asyncpg.Pool | None = None
redis_client: aioredis.Redis | None = None
openai_client: AsyncOpenAI | None = None
anthropic_client: anthropic.AsyncAnthropic | None = None

# ─── Lifespan ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool, redis_client, openai_client, anthropic_client

    db_pool = await asyncpg.create_pool(
        dsn=os.environ["DATABASE_URL"],
        min_size=2,
        max_size=20,
        command_timeout=60,
    )
    redis_client = aioredis.from_url(
        os.environ["REDIS_URL"],
        decode_responses=True,
    )
    openai_client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
    anthropic_client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    logger.info("Compliance AI service started")
    yield

    await db_pool.close()
    await redis_client.aclose()
    logger.info("Compliance AI service stopped")

# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Vecta Compliance AI",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("API_GATEWAY_URL", "http://localhost:4000")],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Dependency Injection ─────────────────────────────────────────────────────

async def get_db() -> asyncpg.Pool:
    return db_pool

async def get_redis() -> aioredis.Redis:
    return redis_client

# ─── Models ───────────────────────────────────────────────────────────────────

class MedicalWaiverRequest(BaseModel):
    student_id: str = Field(..., description="Vecta student UUID")
    university_name: str
    # The university health plan document (PDF/image) is uploaded as a file

class MedicalWaiverResult(BaseModel):
    university_plan_name: str
    annual_deductible: float
    out_of_pocket_max: float
    mental_health_coverage: bool
    dental_coverage: bool
    vision_coverage: bool
    meets_f1_requirements: bool
    ai_confidence_score: float = Field(..., ge=0.0, le=1.0)
    extracted_at: str
    alternative_quotes: list[dict]

class RoommateProfileRequest(BaseModel):
    student_id: str
    major: str
    university_id: str
    sleep_schedule: Literal["EARLY_BIRD", "NIGHT_OWL", "FLEXIBLE"]
    study_environment: Literal["SILENT", "BACKGROUND_NOISE", "SOCIAL"]
    guest_frequency: Literal["NEVER", "RARELY", "SOMETIMES", "OFTEN"]
    cleanliness_level: int = Field(..., ge=1, le=5)
    dietary_restrictions: list[str] = []
    languages: list[str] = []
    hobbies: list[str] = []
    preferred_move_in_date: str
    budget_min: int
    budget_max: int

class RoommateMatch(BaseModel):
    matched_student_id: str
    compatibility_score: float = Field(..., ge=0.0, le=1.0)
    shared_attributes: list[str]
    vector_distance: float

class RoommateMatchResponse(BaseModel):
    matches: list[RoommateMatch]
    profile_id: str
    search_timestamp: str

# ─── Module 1: AI Medical Waiver Analyzer ────────────────────────────────────
# Uses Claude Vision to parse university health plan PDFs.
# Extracts: deductibles, limits, coverage types.
# Then fetches ISO/PSI quotes for comparison.

@app.post("/insurance/analyze-university-plan", response_model=MedicalWaiverResult)
async def analyze_university_health_plan(
    student_id: str,
    university_name: str,
    plan_document: UploadFile = File(..., description="University health plan PDF or image"),
    db: asyncpg.Pool = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
):
    """
    Analyze a university health insurance plan document using Claude Vision.
    Returns extracted coverage details and determines F-1 requirement compliance.
    """
    # Check cache (same document by hash)
    content = await plan_document.read()
    doc_hash = hashlib.sha256(content).hexdigest()
    cache_key = f"vecta:waiver:analysis:{doc_hash}"

    cached = await redis.get(cache_key)
    if cached:
        logger.info("Cache hit for medical waiver analysis", extra={"hash": doc_hash[:16]})
        return MedicalWaiverResult(**json.loads(cached))

    # Encode document for Claude Vision
    media_type = plan_document.content_type or "application/pdf"
    doc_base64 = base64.standard_b64encode(content).decode("utf-8")

    # Build the extraction prompt
    extraction_prompt = """You are a licensed insurance compliance analyst specializing in F-1 student visa requirements.

Analyze this university health insurance plan document and extract the following information in JSON format:

{
  "university_plan_name": "string",
  "annual_deductible": number (USD),
  "out_of_pocket_max": number (USD),
  "mental_health_coverage": boolean,
  "dental_coverage": boolean,
  "vision_coverage": boolean,
  "prescription_coverage": boolean,
  "emergency_coverage_limit": number (USD),
  "maternity_coverage": boolean,
  "pre_existing_conditions_covered": boolean,
  "network_type": "HMO" | "PPO" | "EPO" | "OTHER",
  "confidence_score": number (0.0-1.0, your confidence in the extraction)
}

F-1 Visa insurance requirements (per USCIS guidelines):
- Annual deductible ≤ $500 per accident/illness
- Maximum benefit ≥ $100,000 per accident/illness  
- Repatriation coverage ≥ $25,000
- Medical evacuation coverage ≥ $50,000
- Exclusion for pre-existing conditions ≤ 6 months duration

Set "meets_f1_requirements" to true ONLY if ALL requirements are met.
Return ONLY valid JSON with no markdown or commentary."""

    # Call Claude Vision (Anthropic)
    try:
        message = await anthropic_client.messages.create(
            model="claude-opus-4-5",
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "document",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": doc_base64,
                            },
                        },
                        {"type": "text", "text": extraction_prompt},
                    ],
                }
            ],
        )

        raw_json = message.content[0].text.strip()
        extracted = json.loads(raw_json)

    except json.JSONDecodeError as e:
        logger.error("Claude returned invalid JSON for medical waiver", exc_info=True)
        raise HTTPException(502, detail="AI model returned malformed response. Retry.")
    except anthropic.APIError as e:
        logger.error("Anthropic API error", exc_info=True)
        raise HTTPException(502, detail=f"AI service unavailable: {str(e)}")

    # Determine F-1 compliance
    meets_f1 = (
        extracted.get("annual_deductible", 999999) <= 500 and
        extracted.get("emergency_coverage_limit", 0) >= 100000 and
        extracted.get("pre_existing_conditions_covered", False)
    )

    # Fetch alternative ISO/PSI quotes
    alternative_quotes = await _fetch_iso_psi_quotes(
        student_id=student_id,
        university_name=university_name,
    )

    result = MedicalWaiverResult(
        university_plan_name=extracted.get("university_plan_name", university_name),
        annual_deductible=extracted.get("annual_deductible", 0),
        out_of_pocket_max=extracted.get("out_of_pocket_max", 0),
        mental_health_coverage=extracted.get("mental_health_coverage", False),
        dental_coverage=extracted.get("dental_coverage", False),
        vision_coverage=extracted.get("vision_coverage", False),
        meets_f1_requirements=meets_f1,
        ai_confidence_score=extracted.get("confidence_score", 0.0),
        extracted_at=datetime.utcnow().isoformat(),
        alternative_quotes=alternative_quotes,
    )

    # Cache for 24 hours (same document)
    await redis.setex(cache_key, 86400, result.model_dump_json())

    logger.info(
        "Medical waiver analyzed",
        extra={"student_id": student_id, "meets_f1": meets_f1},
    )

    return result


async def _fetch_iso_psi_quotes(student_id: str, university_name: str) -> list[dict]:
    """Fetch quotes from ISO Student Health Insurance and PSI (two top F-1 providers)."""
    # In production: make parallel API calls to ISO and PSI
    # These are illustrative — replace with real API endpoints
    quotes = []

    iso_res = await _call_iso_api(student_id, university_name)
    if iso_res:
        quotes.append({
            "provider": "ISO",
            "type": "MEDICAL_WAIVER",
            "monthly_premium": iso_res.get("monthly_premium", 0),
            "annual_premium": iso_res.get("annual_premium", 0),
            "deductible": iso_res.get("deductible", 0),
            "coverage_limit": iso_res.get("coverage_limit", 0),
            "quote_id": iso_res.get("quote_id", ""),
            "expires_at": iso_res.get("expires_at", ""),
        })

    return quotes


async def _call_iso_api(student_id: str, university: str) -> dict | None:
    """Fetch real quotes from ISO + PSI via iso_client module."""
    from .iso_client import get_all_quotes
    quotes = await get_all_quotes(student_id, university)
    if not quotes:
        return None
    # Return first F-1-compliant quote as primary recommendation
    compliant = [q for q in quotes if q.is_f1_compliant]
    primary = (compliant or quotes)[0]
    return {
        "provider":           primary.provider,
        "plan_name":          primary.plan_name,
        "deductible":         primary.deductible,
        "coverage_limit":     primary.emergency_coverage,
        "monthly_premium":    primary.monthly_premium,
        "annual_premium":     primary.annual_premium,
        "bind_url":           primary.bind_url,
        "quote_id":           primary.plan_id,
        "is_f1_compliant":    primary.is_f1_compliant,
        "all_quotes":         [
            {
                "provider":        q.provider,
                "plan_name":       q.plan_name,
                "monthly_premium": q.monthly_premium,
                "deductible":      q.deductible,
                "is_f1_compliant": q.is_f1_compliant,
                "bind_url":        q.bind_url,
            }
            for q in quotes
        ],
    }


# ─── Module 2: AI Roommate Matcher (pgvector) ─────────────────────────────────

@app.post("/housing/roommate-profile", response_model=dict)
async def upsert_lifestyle_profile(
    profile: RoommateProfileRequest,
    db: asyncpg.Pool = Depends(get_db),
):
    """
    Create or update a student's lifestyle profile and generate a pgvector embedding
    using OpenAI text-embedding-ada-002. Used for semantic roommate matching.
    """
    # Build a rich text description for embedding
    profile_text = _build_profile_text(profile)

    # Generate 1536-dim embedding
    embedding_response = await openai_client.embeddings.create(
        model="text-embedding-ada-002",
        input=profile_text,
    )
    embedding = embedding_response.data[0].embedding  # list of 1536 floats

    # Convert to pgvector format
    embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"

    async with db.acquire() as conn:
        result = await conn.fetchrow(
            """
            INSERT INTO student_lifestyle_profiles (
                student_id, major, university_id, sleep_schedule, study_env,
                guest_frequency, cleanliness, dietary, languages, hobbies,
                move_in_date, budget_min, budget_max, embedding
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::vector)
            ON CONFLICT (student_id) DO UPDATE SET
                major = EXCLUDED.major,
                university_id = EXCLUDED.university_id,
                sleep_schedule = EXCLUDED.sleep_schedule,
                study_env = EXCLUDED.study_env,
                guest_frequency = EXCLUDED.guest_frequency,
                cleanliness = EXCLUDED.cleanliness,
                dietary = EXCLUDED.dietary,
                languages = EXCLUDED.languages,
                hobbies = EXCLUDED.hobbies,
                move_in_date = EXCLUDED.move_in_date,
                budget_min = EXCLUDED.budget_min,
                budget_max = EXCLUDED.budget_max,
                embedding = EXCLUDED.embedding,
                updated_at = NOW()
            RETURNING id
            """,
            profile.student_id,
            profile.major,
            profile.university_id,
            profile.sleep_schedule,
            profile.study_environment,
            profile.guest_frequency,
            profile.cleanliness_level,
            profile.dietary_restrictions,
            profile.languages,
            profile.hobbies,
            profile.preferred_move_in_date,
            profile.budget_min,
            profile.budget_max,
            embedding_str,
        )

    profile_id = str(result["id"])
    logger.info("Lifestyle profile upserted", extra={"student_id": profile.student_id})

    return {"profile_id": profile_id, "embedding_dimensions": len(embedding)}


@app.get("/housing/roommate-matches/{student_id}", response_model=RoommateMatchResponse)
async def find_roommate_matches(
    student_id: str,
    top_k: int = 10,
    db: asyncpg.Pool = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
):
    """
    Find the top-k most compatible roommates using pgvector cosine similarity search.
    Filters by: same university, overlapping budget, compatible move-in date.
    """
    cache_key = f"vecta:roommates:{student_id}:top{top_k}"
    cached = await redis.get(cache_key)
    if cached:
        return RoommateMatchResponse(**json.loads(cached))

    async with db.acquire() as conn:
        # Fetch the student's own embedding
        row = await conn.fetchrow(
            """
            SELECT embedding, university_id, budget_min, budget_max, move_in_date
            FROM student_lifestyle_profiles
            WHERE student_id = $1
            """,
            student_id,
        )

        if not row:
            raise HTTPException(404, "Lifestyle profile not found. Please complete your profile.")

        # pgvector cosine similarity search with budget and university filters
        # The <=> operator computes cosine distance (0=identical, 2=opposite)
        matches = await conn.fetch(
            """
            SELECT
                slp.student_id AS matched_student_id,
                slp.major,
                slp.sleep_schedule,
                slp.study_env,
                slp.guest_frequency,
                slp.cleanliness,
                slp.languages,
                slp.hobbies,
                slp.budget_min,
                slp.budget_max,
                1 - (slp.embedding <=> $1::vector) AS compatibility_score,
                slp.embedding <=> $1::vector AS vector_distance
            FROM student_lifestyle_profiles slp
            WHERE slp.student_id != $2
              AND slp.university_id = $3
              AND slp.budget_max >= $4
              AND slp.budget_min <= $5
              AND ABS(EXTRACT(DAYS FROM (slp.move_in_date - $6::date))) <= 30
            ORDER BY slp.embedding <=> $1::vector ASC
            LIMIT $7
            """,
            row["embedding"],
            student_id,
            row["university_id"],
            row["budget_min"],
            row["budget_max"],
            row["move_in_date"],
            top_k,
        )

    result_matches = []
    for m in matches:
        # Compute shared attributes for the UI display
        student_row = row  # Re-use from above in production; fetch if needed
        shared = _compute_shared_attributes(row, m)

        result_matches.append(
            RoommateMatch(
                matched_student_id=str(m["matched_student_id"]),
                compatibility_score=round(float(m["compatibility_score"]), 4),
                shared_attributes=shared,
                vector_distance=round(float(m["vector_distance"]), 6),
            )
        )

    response = RoommateMatchResponse(
        matches=result_matches,
        profile_id=student_id,
        search_timestamp=datetime.utcnow().isoformat(),
    )

    # Cache for 15 minutes
    await redis.setex(cache_key, 900, response.model_dump_json())

    return response


def _build_profile_text(profile: RoommateProfileRequest) -> str:
    """
    Builds a rich natural language description of a student's lifestyle preferences.
    This is what gets embedded — richer text = better semantic similarity.
    """
    return (
        f"A {profile.major} student at university {profile.university_id}. "
        f"Sleep schedule: {profile.sleep_schedule.lower().replace('_', ' ')}. "
        f"Study environment preference: {profile.study_environment.lower().replace('_', ' ')}. "
        f"Cleanliness level: {profile.cleanliness_level} out of 5. "
        f"Guest frequency: {profile.guest_frequency.lower()}. "
        f"Dietary restrictions: {', '.join(profile.dietary_restrictions) or 'none'}. "
        f"Languages spoken: {', '.join(profile.languages) or 'English'}. "
        f"Hobbies and interests: {', '.join(profile.hobbies) or 'not specified'}. "
        f"Monthly budget range: ${profile.budget_min} to ${profile.budget_max}. "
        f"Preferred move-in: {profile.preferred_move_in_date}."
    )


def _compute_shared_attributes(student: dict, match: dict) -> list[str]:
    shared = []
    if student.get("sleep_schedule") == match.get("sleep_schedule"):
        shared.append(f"Sleep schedule: {match['sleep_schedule']}")
    if student.get("study_env") == match.get("study_env"):
        shared.append(f"Study environment: {match['study_env']}")
    if student.get("cleanliness") == match.get("cleanliness"):
        shared.append(f"Cleanliness level: {match['cleanliness']}/5")
    # Language overlap
    student_langs = set(student.get("languages") or [])
    match_langs = set(match.get("languages") or [])
    common_langs = student_langs & match_langs
    if common_langs:
        shared.append(f"Shared languages: {', '.join(common_langs)}")
    # Hobby overlap
    student_hobbies = set(student.get("hobbies") or [])
    match_hobbies = set(match.get("hobbies") or [])
    common_hobbies = student_hobbies & match_hobbies
    if common_hobbies:
        shared.append(f"Shared hobbies: {', '.join(list(common_hobbies)[:3])}")
    return shared


# ─── Health Check ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "compliance-ai", "timestamp": datetime.utcnow().isoformat()}


# ─── Module 3: ISO / PSI Health Insurance Quotes ─────────────────────────────

class ISOQuoteItem(BaseModel):
    provider:           str
    plan_name:          str
    monthly_premium:    float
    annual_premium:     float
    deductible:         int
    emergency_coverage: int
    pre_existing:       bool
    is_f1_compliant:    bool
    bind_url:           str
    plan_id:            str
    notes:              str = ""

class ISOQuotesResponse(BaseModel):
    quotes:             list[ISOQuoteItem]
    compliant_count:    int
    cheapest_compliant: ISOQuoteItem | None = None


@app.get("/insurance/iso-quotes", response_model=ISOQuotesResponse)
async def get_iso_quotes(
    student_id:      str = Query(...),
    university:      str = Query(default=""),
    program_start:   str | None = Query(default=None),
    program_end:     str | None = Query(default=None),
):
    """
    Fetch F-1 health insurance quotes from ISO + PSI in parallel.
    Quotes sorted: F-1 compliant first, then cheapest.
    Cached in Redis for 1 hour per student_id.
    """
    cache_key = f"vecta:iso-quotes:{student_id}"

    # Redis cache check
    try:
        cached = await redis_client.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception:
        pass  # Cache miss — fetch live

    from .iso_client import get_all_quotes
    quotes_raw = await get_all_quotes(student_id, university, program_start, program_end)

    items = [
        ISOQuoteItem(
            provider           = q.provider,
            plan_name          = q.plan_name,
            monthly_premium    = q.monthly_premium,
            annual_premium     = q.annual_premium,
            deductible         = q.deductible,
            emergency_coverage = q.emergency_coverage,
            pre_existing       = q.pre_existing,
            is_f1_compliant    = q.is_f1_compliant,
            bind_url           = q.bind_url,
            plan_id            = q.plan_id,
            notes              = q.notes,
        )
        for q in quotes_raw
    ]

    compliant = [q for q in items if q.is_f1_compliant]
    cheapest  = min(compliant, key=lambda q: q.monthly_premium) if compliant else None

    result = ISOQuotesResponse(
        quotes            = items,
        compliant_count   = len(compliant),
        cheapest_compliant = cheapest,
    )

    # Cache for 1 hour
    try:
        await redis_client.setex(cache_key, 3600, result.model_dump_json())
    except Exception:
        pass

    return result

