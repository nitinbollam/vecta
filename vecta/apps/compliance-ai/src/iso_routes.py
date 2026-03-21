"""
Append to apps/compliance-ai/src/main.py — ISO/PSI health insurance quotes endpoint.

This module is appended to the existing main.py. In the actual file, these
functions and routes should be placed after the existing roommate matcher section.
"""

# ---------------------------------------------------------------------------
# ISO / PSI Health Insurance Quotes (exposed via GET for API gateway proxy)
# ---------------------------------------------------------------------------

from .iso_client import get_all_quotes as _get_all_iso_quotes

class ISOQuoteResponse(BaseModel):
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

class ISOQuotesListResponse(BaseModel):
    quotes:            list[ISOQuoteResponse]
    compliant_count:   int
    cheapest_compliant: ISOQuoteResponse | None
