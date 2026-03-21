// apps/landlord-portal/src/components/IdentitySection.tsx
// ─── Identity & Visa Status — Landlord View ───────────────────────────────────
// SHOWS: Legal name, face photo, NFC verified status, visa type + expiry year
// HIDES: Passport number, country of origin, I-20 / SEVIS ID

"use client";

import Image from "next/image";

interface IdentityData {
  legalName: string;
  facePhotoUrl: string;
  idStatusLabel: string;
  legalUSStatus: string;
}

export function IdentitySection({ data }: { data: IdentityData }) {
  return (
    <section className="verification-section" aria-labelledby="identity-heading">
      <div className="section-header">
        <span className="section-icon">🪪</span>
        <h2 id="identity-heading" className="section-title">
          Identity &amp; Visa Status
        </h2>
      </div>

      <div className="identity-card">
        {/* Face Photo — from Didit liveness check */}
        <div className="photo-container">
          {data.facePhotoUrl ? (
            <div className="photo-wrapper">
              <Image
                src={data.facePhotoUrl}
                alt={`Verified photo of ${data.legalName}`}
                width={120}
                height={120}
                className="face-photo"
                priority
              />
              <div className="photo-badge" aria-label="Liveness verified">
                ✓ Live
              </div>
            </div>
          ) : (
            <div className="photo-placeholder" aria-label="Photo unavailable">
              <span>👤</span>
            </div>
          )}
          <p className="photo-caption">
            NFC Liveness Verified
            <br />
            <small>Selfie taken during passport scan</small>
          </p>
        </div>

        {/* Identity Details */}
        <div className="identity-details">
          <div className="detail-row">
            <span className="detail-label">Full Legal Name</span>
            <span className="detail-value name-value">{data.legalName}</span>
          </div>

          <div className="detail-row">
            <span className="detail-label">Verification Status</span>
            <div className="status-badge status-verified" role="status">
              ✅ {data.idStatusLabel}
            </div>
          </div>

          <div className="detail-row">
            <span className="detail-label">Legal US Status</span>
            <span className="detail-value">{data.legalUSStatus}</span>
          </div>
        </div>
      </div>

      {/* What is hidden — Fair Housing Act compliance notice */}
      <div className="vault-notice vault-notice--compact">
        <span className="vault-icon">🔒</span>
        <p className="vault-text">
          <strong>Privacy Protection:</strong> Passport number and country of origin are vaulted
          per the Fair Housing Act (42 U.S.C. § 3604). Vecta does not disclose national origin.
        </p>
      </div>
    </section>
  );
}

// ─── Financial Solvency Section ───────────────────────────────────────────────
// SHOWS: Trust score, solvency guarantee, LoC download link, rent split status
// HIDES: Exact bank balance, home-country account numbers, tuition amounts

interface FinancialData {
  trustScore: number;
  trustScoreTier: string;
  solvencyLabel: string;
  letterOfCreditDownloadUrl: string;
  rentSplitEnabled: boolean;
}

export function FinancialSection({ data }: { data: FinancialData }) {
  const tierColor = {
    EXCELLENT: "#16a34a",
    GOOD: "#2563eb",
    FAIR: "#d97706",
    BUILDING: "#9ca3af",
  }[data.trustScoreTier] ?? "#6b7280";

  return (
    <section className="verification-section" aria-labelledby="financial-heading">
      <div className="section-header">
        <span className="section-icon">💰</span>
        <h2 id="financial-heading" className="section-title">
          Financial Solvency
        </h2>
        <span className="section-subtitle">No Co-Signer Required</span>
      </div>

      <div className="financial-grid">
        {/* Trust Score */}
        <div className="financial-card">
          <span className="financial-label">Vecta Trust Score</span>
          <div className="trust-score-display">
            <span
              className="trust-score-number"
              style={{ color: tierColor }}
              aria-label={`Trust score: ${data.trustScore}`}
            >
              {data.trustScore}
            </span>
            <span className="trust-score-tier" style={{ color: tierColor }}>
              {data.trustScoreTier}
            </span>
          </div>
          <p className="financial-note">
            Translated from verified international credit history via Nova Credit
          </p>
        </div>

        {/* Proof of Funds */}
        <div className="financial-card financial-card--highlight">
          <span className="financial-label">Proof of Funds Status</span>
          <div
            className="solvency-badge"
            role="status"
            aria-live="polite"
          >
            ✅ {data.solvencyLabel}
          </div>
          <p className="financial-note">
            Vecta acts as financial guarantor for the security deposit
          </p>
        </div>

        {/* Letter of Credit */}
        <div className="financial-card financial-card--action">
          <span className="financial-label">Vecta Letter of Credit</span>
          <p className="financial-subtext">
            Cryptographically signed PDF — tamper-evident via SHA-256
          </p>
          {data.letterOfCreditDownloadUrl ? (
            <a
              href={data.letterOfCreditDownloadUrl}
              className="download-button"
              download="Vecta_Letter_of_Credit.pdf"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Download Letter of Credit PDF"
            >
              ↓ Download Letter of Credit
            </a>
          ) : (
            <span className="status-pending">Generating…</span>
          )}
        </div>

        {/* Rent Split */}
        <div className="financial-card">
          <span className="financial-label">Automated Rent Collection</span>
          <div className={`toggle-badge ${data.rentSplitEnabled ? "toggle-badge--on" : "toggle-badge--off"}`}>
            {data.rentSplitEnabled ? "✅ Enabled" : "Not Set Up"}
          </div>
          <p className="financial-note">
            Vecta will collect from all roommates and send one lump-sum payment
          </p>
        </div>
      </div>

      {/* Vault notice */}
      <div className="vault-notice vault-notice--compact">
        <span className="vault-icon">🔒</span>
        <p className="vault-text">
          <strong>Privacy Protection:</strong> Exact account balance, home-country banking details,
          and tuition records are vaulted and never accessible to landlords.
        </p>
      </div>
    </section>
  );
}

// ─── Contact & Connectivity Section ──────────────────────────────────────────
// SHOWS: US phone (eSIM), verified email, university affiliation
// HIDES: Device IMEI, home-country phone numbers

interface ContactData {
  usPhoneNumber: string;
  verifiedEmail: string;
  universityAffiliation: string;
}

export function ContactSection({ data }: { data: ContactData }) {
  return (
    <section className="verification-section" aria-labelledby="contact-heading">
      <div className="section-header">
        <span className="section-icon">📞</span>
        <h2 id="contact-heading" className="section-title">
          Contact &amp; Connectivity
        </h2>
      </div>

      <div className="contact-grid">
        <div className="contact-row">
          <span className="contact-icon">📱</span>
          <div>
            <span className="contact-label">US Phone Number</span>
            <a href={`tel:${data.usPhoneNumber}`} className="contact-value">
              {data.usPhoneNumber}
            </a>
            <span className="contact-note">Vecta eSIM-provisioned US number</span>
          </div>
        </div>

        <div className="contact-row">
          <span className="contact-icon">✉️</span>
          <div>
            <span className="contact-label">Verified Email</span>
            <a href={`mailto:${data.verifiedEmail}`} className="contact-value">
              {data.verifiedEmail}
            </a>
          </div>
        </div>

        <div className="contact-row">
          <span className="contact-icon">🎓</span>
          <div>
            <span className="contact-label">University Affiliation</span>
            <span className="contact-value">{data.universityAffiliation}</span>
            <span className="contact-note contact-note--verified">
              ✅ Enrollment Confirmed
            </span>
          </div>
        </div>
      </div>

      <div className="vault-notice vault-notice--compact">
        <span className="vault-icon">🔒</span>
        <p className="vault-text">
          <strong>Privacy Protection:</strong> Device IMEI and home-country phone numbers
          are vaulted and never disclosed.
        </p>
      </div>
    </section>
  );
}

// ─── Privacy Vault Notice ─────────────────────────────────────────────────────

export function PrivacyVaultNotice() {
  return (
    <section className="privacy-vault-section" aria-labelledby="privacy-heading">
      <div className="vault-header">
        <span className="vault-header-icon">🔐</span>
        <h3 id="privacy-heading">Vecta Privacy Vault</h3>
      </div>
      <p className="vault-description">
        Vecta is built on a "data minimization" architecture. The following information
        is encrypted, vaulted, and inaccessible to landlords under all circumstances:
      </p>
      <ul className="vault-list" aria-label="Vaulted information">
        <li>Passport Number (AES-256-GCM encrypted)</li>
        <li>Country of Origin (Fair Housing Act — 42 U.S.C. § 3604)</li>
        <li>I-20 Document &amp; SEVIS ID</li>
        <li>Exact Bank Account Balance</li>
        <li>Home-Country Bank Account Details</li>
        <li>Tuition Payment Records</li>
        <li>Device IMEI</li>
        <li>Home-Country Phone Numbers</li>
      </ul>
      <p className="vault-legal">
        Vecta's privacy architecture was designed with Fair Housing Act compliance
        as a first-class requirement. Disclosure of country of origin or national origin
        data in the tenant screening process creates protected-class discrimination risk.
        Vecta eliminates this risk architecturally.
      </p>
    </section>
  );
}

// ─── Verification Footer ──────────────────────────────────────────────────────

export function VerificationFooter({ expiresAt }: { expiresAt: string }) {
  const expiryDate = new Date(expiresAt);
  const isExpiringSoon = expiryDate.getTime() - Date.now() < 1000 * 60 * 60 * 4; // < 4 hours

  return (
    <footer className="verification-footer">
      <div className="footer-security">
        <span>🔒 Secured by RS256 JWT · pgvector · AES-256-GCM</span>
      </div>
      <div className={`footer-expiry ${isExpiringSoon ? "footer-expiry--warning" : ""}`}>
        {isExpiringSoon ? "⚠️" : "⏱"} Token expires:{" "}
        {expiryDate.toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })}
        {isExpiringSoon && " — Ask student to refresh"}
      </div>
      <div className="footer-contact">
        Questions about this verification?{" "}
        <a href="mailto:landlords@vecta.app">landlords@vecta.app</a>
        {" · "}
        <a href="https://vecta.app/landlords/faq">Landlord FAQ</a>
      </div>
      <div className="footer-legal">
        This verification was performed using cryptographically signed data.
        Vecta ID Tokens are non-transferable and expire automatically.
        Vecta, Inc. serves as financial guarantor per the referenced Letter of Credit.
      </div>
    </footer>
  );
}
