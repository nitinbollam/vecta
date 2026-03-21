# Architecture Decision Records — Vecta Platform

> These ADRs document the key design decisions made during platform construction,
> with particular focus on F-1 visa compliance and Fair Housing Act enforcement.

---

## ADR-001: Four-Layer F-1 Compliance Enforcement

**Date:** 2025-06  
**Status:** Accepted

### Context
F-1 students on Vecta's vehicle lease-back program must earn strictly passive income
(Schedule E / 1099-MISC Box 1: Rents). Any active transportation service would reclassify
income as Schedule C, invalidate F-1 status, and expose Vecta to legal liability.

### Decision
Enforce the prohibition at **four independent layers** — any single layer failing is insufficient:

| Layer | Mechanism | Failure Mode |
|-------|-----------|-------------|
| 1 | PostgreSQL `CHECK` constraint: `driver_user_id != lessor_student_id` | Hard DB error |
| 2 | PostgreSQL `RULE`: no UPDATE/DELETE on `flight_recorder` | Append-only evidence |
| 3 | RBAC: `mobility:accept_ride` and `mobility:go_online_as_driver` have `[]` allowed roles | 403 before handler |
| 4 | `ScheduleEValidator.validateRideCompliance()` runtime check | F1ComplianceError |

### Consequences
- Passes TypeScript type-check: `z.literal(true)` consent fields cannot be `false` at compile time
- Database is authoritative — even a compromised API layer cannot insert a violating record
- The RBAC dead-end pattern means the forbidden action literally has no code path to success
- Audit chain hash-locks evidence so post-hoc tampering is detectable

---

## ADR-002: Vecta ID Token — Zero PII in JWT Payload

**Date:** 2025-06  
**Status:** Accepted

### Context
Landlords verify student identity by presenting a Vecta ID token. The token must be shareable
(copyable URL) yet must not expose PII if intercepted or logged.

### Decision
The RS256 JWT payload contains **zero PII**:

```
Allowed fields: sub (studentId), iss, aud, iat, exp, jti, role, kycStatus,
                universityId, programOfStudy, visaStatus, selfieKey (S3 key only)

Forbidden fields: passportNumber, nationality, countryOfOrigin, bankBalance,
                  accountNumber, imei, homeAddress, taxId
```

Sensitive data is fetched server-side when the landlord portal calls `verifyVectaIDToken()`.
The selfie is served as a 15-minute signed S3 URL generated at verification time — the URL is
never cached in the JWT or on disk.

### Consequences
- JWT can be safely logged in access logs without PII exposure
- Passport number and nationality never travel over the wire after initial KYC
- Selfie URL expiry (15 min) limits exposure if a URL leaks
- Fair Housing Act compliance: country of origin is encrypted at rest and absent from all transport

---

## ADR-003: pgvector for Roommate Matching

**Date:** 2025-06  
**Status:** Accepted

### Context
Roommate compatibility requires multi-dimensional lifestyle matching (8+ attributes). Traditional
SQL WHERE clauses produce poor matches; collaborative filtering requires user history Vecta doesn't have.

### Decision
Use OpenAI `text-embedding-ada-002` (1536 dimensions) to embed student lifestyle profiles into
vector space, stored in pgvector (`vector(1536)` column with `IVFFlat` index). Match using
cosine similarity (`<=>` operator) filtered by university, budget overlap, and move-in date window.

```sql
SELECT s2.id, 1 - (s1.lifestyle_embedding <=> s2.lifestyle_embedding) AS score
FROM student_lifestyle_profiles s1
JOIN student_lifestyle_profiles s2 ON s1.university_id = s2.university_id
WHERE s1.student_id = $1 AND s2.student_id != $1
  AND s2.budget_min <= $2 AND s2.budget_max >= $3
ORDER BY score DESC LIMIT 20;
```

### Consequences
- Embedding generation runs in the compliance-ai service (Python + asyncpg) — keeps OpenAI calls server-side
- Profiles are re-embedded on any preference change
- No embedding ever contains PII — only lifestyle attributes and anonymized academic category
- IVFFlat index (`lists=100`) handles up to ~1M profiles before requiring IVFFlat → HNSW upgrade

---

## ADR-004: Append-Only Flight Recorder with Hash Chain

**Date:** 2025-06  
**Status:** Accepted

### Context
USCIS and IRS require tamper-proof records for income earned under Schedule E arrangements.
Standard database records can be modified by a compromised admin.

### Decision
The `flight_recorder` table is append-only at the PostgreSQL rule level:

```sql
CREATE RULE no_update_flight_recorder AS ON UPDATE TO flight_recorder DO INSTEAD NOTHING;
CREATE RULE no_delete_flight_recorder AS ON DELETE TO flight_recorder DO INSTEAD NOTHING;
```

Each row also stores `previous_hash` and `hash = HMAC-SHA256(canonical_data + previous_hash + pepper)`,
forming a Merkle-style chain. Before any USCIS/IRS export, `exportAuditChain()` verifies the
full chain from genesis to tip.

### Consequences
- Rules operate at the storage engine level — even a `SUPERUSER` session is blocked
- Hash chain verification is O(n) but runs client-side on export — no online dependency
- A gap in the chain (e.g., deleted row via pg_catalog bypass) is immediately detectable
- Genesis hash is `SHA-256("vecta:genesis:" + studentId)` — deterministic, auditable

---

## ADR-005: AES-256-GCM Field Encryption for PII Columns

**Date:** 2025-06  
**Status:** Accepted

### Context
Database-level encryption (TDE) protects data at rest but not from compromised application
queries. Column-level encryption protects individual fields even if the DB is breached.

### Decision
PII columns (`passport_number`, `nationality`, `encrypted_access_token`, `unit_account_id_encrypted`)
are encrypted with AES-256-GCM using a master key derived via PBKDF2-SHA512 (600,000 iterations).
Each value is self-contained: `base64url(iv):base64url(authTag):base64url(ciphertext)`.

Key is stored in environment variable `VECTA_FIELD_ENCRYPTION_KEY`, rotated quarterly via a
migration script that re-encrypts all rows with the new key.

### Consequences
- Decryption requires both the database row AND the encryption key — breach of DB alone is insufficient
- Auth tag (128-bit GCM tag) detects tampering — modified ciphertext throws on decrypt
- Token format is parseable and self-describing — no separate IV column needed
- IMEI is an explicit exception: it is passed directly to eSIM Go and **never stored**, not even encrypted

---

## ADR-006: Redis Token Revocation with Fail-Closed Production Policy

**Date:** 2025-06  
**Status:** Accepted

### Context
JWTs are stateless and cannot be invalidated before expiry unless a revocation list is checked.
For a platform handling immigration-sensitive data, stale tokens after logout/revocation are unacceptable.

### Decision
Every authenticated request checks Redis: `SISMEMBER vecta:revoked_tokens <jti>`.
Revoked JTIs are added to the set with TTL matching token expiry.

**Fail policy:**
- Development: fail **open** (Redis unavailable → request proceeds with warning log)
- Production: fail **closed** (Redis unavailable → 503 Service Unavailable)

### Consequences
- ~1ms latency per request for Redis lookup (acceptable; Redis is co-located)
- Logout is instantaneous — token is revoked in Redis before response returns
- Production fail-closed means a Redis outage blocks authenticated traffic — acceptable tradeoff
  given the data sensitivity
- Revocation set is ephemeral — entries auto-expire, no maintenance needed
