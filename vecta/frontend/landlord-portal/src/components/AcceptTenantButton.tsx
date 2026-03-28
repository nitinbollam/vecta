'use client';

/**
 * apps/landlord-portal/src/components/AcceptTenantButton.tsx
 *
 * Client Component island — the only interactive part of the certificate page.
 *
 * Flow:
 *   1. Landlord clicks "Accept Tenant"
 *   2. Modal opens — fills property address, monthly rent, lease dates
 *   3. POST /api/v1/certificate/:certId/accept → creates lease_application
 *   4. Success: confirmation with applicationId
 *   5. Contingent cert: extra warning shown before confirming
 *
 * Disabled if: certStatus === 'PARTIAL' (solvency not verified)
 */

import { useState, useCallback, type ReactNode } from 'react';

interface AcceptTenantButtonProps {
  certId:           string;
  certStatus:       'FULL' | 'CONTINGENT' | 'PARTIAL' | 'INVALID';
  maxRentApproval:  number;
  guaranteeMonths:  number;
}

interface LeaseForm {
  propertyAddress:       string;
  monthlyRent:           string;
  leaseStartDate:        string;
  leaseDurationMonths:   string;
  landlordEmail:         string;
}

type ModalState = 'closed' | 'form' | 'confirming' | 'success' | 'error';

const today = new Date().toISOString().slice(0, 10);

const DEFAULT_FORM: LeaseForm = {
  propertyAddress:     '',
  monthlyRent:         '',
  leaseStartDate:      today,
  leaseDurationMonths: '12',
  landlordEmail:       '',
};

export function AcceptTenantButton({
  certId,
  certStatus,
  maxRentApproval,
  guaranteeMonths,
}: AcceptTenantButtonProps): ReactNode {

  const [modal,         setModal]         = useState<ModalState>('closed');
  const [form,          setForm]          = useState<LeaseForm>(DEFAULT_FORM);
  const [formError,     setFormError]     = useState('');
  const [applicationId, setApplicationId] = useState('');
  const [loading,       setLoading]       = useState(false);

  const isDisabled = certStatus === 'PARTIAL' || certStatus === 'INVALID';
  const isContingent = certStatus === 'CONTINGENT';

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  function validateForm(): string | null {
    if (!form.propertyAddress.trim() || form.propertyAddress.length < 5) {
      return 'Please enter the full property address.';
    }
    const rent = parseFloat(form.monthlyRent);
    if (!rent || rent < 100) {
      return 'Please enter a valid monthly rent amount.';
    }
    if (maxRentApproval > 0 && rent > maxRentApproval) {
      return `Monthly rent ($${rent.toLocaleString()}) exceeds the maximum approved amount ($${maxRentApproval.toLocaleString()}). The applicant's guarantee may not fully cover this amount.`;
    }
    if (!form.leaseStartDate) {
      return 'Please select a lease start date.';
    }
    const duration = parseInt(form.leaseDurationMonths, 10);
    if (!duration || duration < 1 || duration > 24) {
      return 'Lease duration must be between 1 and 24 months.';
    }
    if (duration > guaranteeMonths) {
      return `Warning: lease duration (${duration} months) exceeds the verified guarantee period (${guaranteeMonths} months). This is permitted but note the guarantee only covers ${guaranteeMonths} months.`;
    }
    if (!form.landlordEmail.includes('@')) {
      return 'Please enter your email address to receive the lease agreement.';
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  const handleSubmit = useCallback(async () => {
    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setLoading(true);
    setFormError('');

    try {
      const res = await fetch(`/api/v1/certificate/${certId}/accept`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          landlordEmail:       form.landlordEmail.trim().toLowerCase(),
          propertyAddress:     form.propertyAddress.trim(),
          monthlyRent:         parseFloat(form.monthlyRent),
          leaseStartDate:      form.leaseStartDate,
          leaseDurationMonths: parseInt(form.leaseDurationMonths, 10),
        }),
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string; message?: string };
        throw new Error(err.message ?? `Request failed: ${res.status}`);
      }

      const data = await res.json() as { applicationId: string };
      setApplicationId(data.applicationId);
      setModal('success');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
      setModal('error');
    } finally {
      setLoading(false);
    }
  }, [certId, form, guaranteeMonths, maxRentApproval]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      {/* Main button */}
      <div className="space-y-3">
        {isDisabled ? (
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 text-center">
            <p className="text-sm font-semibold text-gray-500">
              {certStatus === 'PARTIAL'
                ? '⏳ Financial verification pending — acceptance available once solvency is confirmed.'
                : '❌ This certificate is not valid for acceptance.'}
            </p>
          </div>
        ) : (
          <>
            {isContingent && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                <span className="font-bold">Conditional acceptance: </span>
                Background check is still in progress. Your acceptance will be marked
                "contingent" until screening completes.
              </div>
            )}
            <button
              onClick={() => setModal('form')}
              className="w-full bg-[#001F3F] hover:bg-[#003060] text-white font-extrabold text-base py-4 px-6 rounded-2xl transition-colors shadow-sm flex items-center justify-center gap-3"
            >
              <span>✅</span>
              <span>Accept Tenant {isContingent ? '(Contingent)' : '& Sign Guarantor Agreement'}</span>
            </button>
            <p className="text-xs text-gray-400 text-center">
              A lease agreement will be sent to both you and the applicant via email.
            </p>
          </>
        )}
      </div>

      {/* Modal overlay */}
      {modal !== 'closed' && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
          onClick={(e) => e.target === e.currentTarget && setModal('closed')}
          role="dialog"
          aria-modal="true"
          aria-label="Accept tenant"
        >
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">

            {/* Success state */}
            {modal === 'success' && (
              <div className="p-8 text-center">
                <div className="text-5xl mb-4">🎉</div>
                <h2 className="text-xl font-extrabold text-gray-900 mb-2">Tenant Accepted!</h2>
                <p className="text-sm text-gray-500 mb-6">
                  A lease agreement has been prepared. Both you and the applicant will
                  receive it by email within a few minutes.
                </p>
                <div className="bg-gray-50 rounded-xl p-4 text-left mb-6">
                  <p className="text-xs font-bold text-gray-500 uppercase mb-1">Application Reference</p>
                  <p className="font-mono text-sm text-gray-800 break-all">{applicationId}</p>
                </div>
                <button
                  onClick={() => setModal('closed')}
                  className="w-full font-bold py-3 rounded-full text-sm" style={{ background: '#00E6CC', color: '#001F3F' }}
                >
                  Done
                </button>
              </div>
            )}

            {/* Form state */}
            {(modal === 'form' || modal === 'confirming' || modal === 'error') && (
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-extrabold text-gray-900 text-lg">Accept Tenant</h2>
                  <button
                    onClick={() => setModal('closed')}
                    className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 transition-colors"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-4">

                  {/* Property address */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                      Property Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.propertyAddress}
                      onChange={(e) => { setForm(f => ({ ...f, propertyAddress: e.target.value })); setFormError(''); }}
                      placeholder="123 Main St, Apt 4B, Cambridge, MA 02139"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#001F3F]"
                    />
                  </div>

                  {/* Monthly rent */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                      Monthly Rent (USD) <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-semibold">$</span>
                      <input
                        type="number"
                        min="100"
                        max={maxRentApproval > 0 ? maxRentApproval : undefined}
                        value={form.monthlyRent}
                        onChange={(e) => { setForm(f => ({ ...f, monthlyRent: e.target.value })); setFormError(''); }}
                        placeholder="1500"
                        className="w-full rounded-xl border border-gray-200 pl-8 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#001F3F]"
                      />
                    </div>
                    {maxRentApproval > 0 && (
                      <p className="text-xs text-gray-400 mt-1">
                        Approved up to ${maxRentApproval.toLocaleString()}/mo
                      </p>
                    )}
                  </div>

                  {/* Lease dates */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                        Lease Start <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        min={today}
                        value={form.leaseStartDate}
                        onChange={(e) => setForm(f => ({ ...f, leaseStartDate: e.target.value }))}
                        className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#001F3F]"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                        Duration
                      </label>
                      <select
                        value={form.leaseDurationMonths}
                        onChange={(e) => setForm(f => ({ ...f, leaseDurationMonths: e.target.value }))}
                        className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#001F3F] bg-white"
                      >
                        {[6, 9, 12, 15, 18, 24].map((m) => (
                          <option key={m} value={m}>{m} months{m === 12 ? ' (standard)' : ''}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Landlord email */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                      Your Email <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      value={form.landlordEmail}
                      onChange={(e) => { setForm(f => ({ ...f, landlordEmail: e.target.value })); setFormError(''); }}
                      placeholder="you@yourcompany.com"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#001F3F]"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      Lease agreement and application reference will be sent here.
                    </p>
                  </div>

                  {/* Error */}
                  {formError && (
                    <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-700">
                      {formError}
                    </div>
                  )}

                  {/* Contingent warning */}
                  {isContingent && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                      <span className="font-bold">Contingent acceptance: </span>
                      This acceptance will be finalized once the pending background check completes.
                    </div>
                  )}

                  {/* Submit */}
                  <button
                    onClick={handleSubmit}
                    disabled={loading}
                    className="w-full disabled:opacity-60 font-extrabold py-4 rounded-2xl text-sm transition-colors flex items-center justify-center gap-2 mt-2" style={{ background: '#00E6CC', color: '#001F3F' }}
                  >
                    {loading ? (
                      <>
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                        Processing…
                      </>
                    ) : (
                      <>✅ Confirm Acceptance</>
                    )}
                  </button>

                  <p className="text-xs text-gray-400 text-center">
                    By confirming, you agree to Vecta's Guarantor Agreement Terms.
                  </p>

                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </>
  );
}
