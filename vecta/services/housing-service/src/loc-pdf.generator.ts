/**
 * loc-pdf.generator.ts — Vecta Letter of Credit PDF
 *
 * Generates a branded, cryptographically-signed PDF Letter of Credit.
 * The document attests financial solvency without revealing exact balances.
 *
 * Layout:
 *   - Vecta letterhead (logo + tagline)
 *   - Addressee block (landlord name + property address if provided)
 *   - Declaration paragraph
 *   - Coverage table (monthly rent × 12, security deposit covered)
 *   - Legal boilerplate
 *   - HMAC-SHA256 integrity stamp + QR code link for landlord verification
 *   - Signature block (Compliance Officer placeholder)
 */

import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { hmacSign } from '@vecta/crypto';
import { createLogger } from '@vecta/logger';

const logger = createLogger('loc-pdf-generator');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LocPdfInput {
  locId: string;
  studentName: string;           // verified legal name from passport
  universityName: string;
  programOfStudy: string;
  visaStatus: string;            // e.g. "F-1 Student Visa"
  visaValidThrough: string;      // e.g. "Duration of Status (D/S)"
  guaranteeMonths: number;       // typically 12
  monthlyRent: number;           // used to calculate total guarantee ceiling
  currency: string;              // 'USD'
  novaCreditTier: string;        // e.g. "Excellent"
  trustScore: number;            // 300–850 translated score
  generatedAt: Date;
  expiresAt: Date;               // typically 30 days from generation
  landlordName?: string;
  propertyAddress?: string;
  verificationBaseUrl?: string;  // for QR code
}

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------

const COLORS = {
  primary:   '#001F3F',  // Vecta navy
  accent:    '#00E6CC',  // Vecta cyan
  text:      '#1A1A2E',
  muted:     '#6B7280',
  success:   '#10B981',
  border:    '#E5E7EB',
  white:     '#FFFFFF',
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export async function generateLocPDF(input: LocPdfInput): Promise<Buffer> {
  logger.info({ locId: input.locId, studentName: '[REDACTED]' }, 'Generating LoC PDF');

  return new Promise(async (resolve, reject) => {
    try {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 60, bottom: 60, left: 72, right: 72 },
        info: {
          Title: `Vecta Letter of Credit — ${input.locId}`,
          Author: 'Vecta Compliance Platform',
          Subject: 'Financial Guarantee — Letter of Credit',
          Keywords: 'vecta, letter of credit, financial guarantee, F-1, housing',
          Creator: 'Vecta Platform v1.0',
        },
      });

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // -----------------------------------------------------------------------
      // Header — Vecta branding
      // -----------------------------------------------------------------------
      doc
        .rect(0, 0, doc.page.width, 100)
        .fill(COLORS.primary);

      doc
        .fillColor(COLORS.white)
        .fontSize(28)
        .font('Helvetica-Bold')
        .text('VECTA', 72, 28, { continued: true })
        .fillColor(COLORS.accent)
        .text('  ·  LETTER OF CREDIT', { continued: false });

      doc
        .fillColor(COLORS.white)
        .fontSize(10)
        .font('Helvetica')
        .text('Life-as-a-Service  ·  Financial Guarantee Division', 72, 62);

      doc
        .fillColor(COLORS.white)
        .fontSize(9)
        .text(
          `Document ID: ${input.locId}   ·   Issued: ${input.generatedAt.toLocaleDateString('en-US', { dateStyle: 'long' })}   ·   Valid Until: ${input.expiresAt.toLocaleDateString('en-US', { dateStyle: 'long' })}`,
          72,
          80,
        );

      doc.moveDown(4);

      // -----------------------------------------------------------------------
      // Addressee block
      // -----------------------------------------------------------------------
      if (input.landlordName || input.propertyAddress) {
        doc
          .fillColor(COLORS.text)
          .fontSize(11)
          .font('Helvetica')
          .text('TO:', { continued: false });

        if (input.landlordName) {
          doc.font('Helvetica-Bold').text(input.landlordName);
        }
        if (input.propertyAddress) {
          doc.font('Helvetica').text(input.propertyAddress);
        }
        doc.moveDown(1.5);
      }

      // -----------------------------------------------------------------------
      // Re: line
      // -----------------------------------------------------------------------
      doc
        .fillColor(COLORS.primary)
        .font('Helvetica-Bold')
        .fontSize(11)
        .text('RE: Financial Guarantee for Residential Lease Application');
      doc.moveDown(1);

      // -----------------------------------------------------------------------
      // Declaration
      // -----------------------------------------------------------------------
      const guarantee = (input.monthlyRent * input.guaranteeMonths).toLocaleString('en-US', {
        style: 'currency',
        currency: input.currency,
      });

      const monthlyRentStr = input.monthlyRent.toLocaleString('en-US', {
        style: 'currency',
        currency: input.currency,
      });

      doc
        .fillColor(COLORS.text)
        .font('Helvetica')
        .fontSize(10.5)
        .text(
          `This Letter of Credit is issued by Vecta Financial Services LLC ("Vecta") on behalf of the following verified student applicant. Vecta hereby guarantees rental payments up to ${guarantee} over ${input.guaranteeMonths} months, with an aggregate monthly commitment not to exceed ${monthlyRentStr}, subject to the terms and conditions set forth herein.`,
          { align: 'justify' },
        );

      doc.moveDown(1.5);

      // -----------------------------------------------------------------------
      // Student identity table
      // -----------------------------------------------------------------------
      drawSectionHeader(doc, 'STUDENT IDENTITY — VERIFIED');

      const identityRows: [string, string][] = [
        ['Full Legal Name', input.studentName],
        ['University', input.universityName],
        ['Program of Study', input.programOfStudy],
        ['Immigration Status', input.visaStatus],
        ['Visa Validity', input.visaValidThrough],
        ['Identity Verification', '✓ NFC Chip Passport   ✓ Liveness Check   ✓ Biometric Match'],
      ];
      drawTable(doc, identityRows);
      doc.moveDown(1);

      // -----------------------------------------------------------------------
      // Financial solvency table
      // -----------------------------------------------------------------------
      drawSectionHeader(doc, 'FINANCIAL SOLVENCY — VERIFIED');

      const financialRows: [string, string][] = [
        ['Vecta Trust Score', `${input.trustScore} — ${input.novaCreditTier}`],
        ['Monthly Rent Covered', monthlyRentStr],
        ['Guarantee Duration', `${input.guaranteeMonths} months`],
        ['Total Guarantee Ceiling', guarantee],
        ['Security Deposit', 'Covered (1 month equivalent)'],
        ['Proof of Solvency', '✓ Plaid Asset Report Verified   ✓ Multi-Institution Cross-Check'],
      ];
      drawTable(doc, financialRows);
      doc.moveDown(1.5);

      // -----------------------------------------------------------------------
      // Terms
      // -----------------------------------------------------------------------
      drawSectionHeader(doc, 'TERMS & CONDITIONS');
      doc
        .fillColor(COLORS.text)
        .font('Helvetica')
        .fontSize(9)
        .text(
          '1. This letter constitutes a guarantee of rental payment capacity only and does not represent a direct surety bond. 2. Vecta may be contacted to confirm the validity of this document via the QR code or verification URL below. 3. This document expires on the date indicated above and must be re-issued for any lease commencing after that date. 4. Vecta does not disclose the student\'s exact bank balance, home-country account details, or routing numbers to any third party, consistent with the Fair Housing Act (42 U.S.C. § 3604) and Vecta\'s Privacy Policy. 5. This document is cryptographically signed. Any alteration voids the guarantee.',
          { align: 'justify' },
        );

      doc.moveDown(2);

      // -----------------------------------------------------------------------
      // Integrity stamp + QR code
      // -----------------------------------------------------------------------
      const verificationUrl = `${input.verificationBaseUrl ?? 'https://verify.vecta.io'}/loc/${input.locId}`;
      const integrityPayload = [
        input.locId,
        input.studentName,
        input.generatedAt.toISOString(),
        input.expiresAt.toISOString(),
        String(input.monthlyRent),
        String(input.guaranteeMonths),
      ].join('|');
      const signature = hmacSign(integrityPayload);

      // QR code as base64 PNG
      const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 120,
      });
      const qrB64 = qrDataUrl.split(',')[1];
      if (!qrB64) throw new Error('Malformed QR data URL');
      const qrBuffer = Buffer.from(qrB64, 'base64');

      const stampY = doc.y;
      doc.image(qrBuffer, doc.page.width - 72 - 90, stampY, { width: 90 });

      doc
        .fillColor(COLORS.muted)
        .fontSize(7.5)
        .font('Courier')
        .text(`SHA-256 Integrity Stamp:`, 72, stampY)
        .text(signature.slice(0, 32) + '\n' + signature.slice(32), 72, stampY + 12)
        .font('Helvetica')
        .text('Scan QR or visit:', 72, stampY + 40)
        .fillColor(COLORS.primary)
        .text(verificationUrl, 72, stampY + 52);

      doc.moveDown(7);

      // -----------------------------------------------------------------------
      // Signature block
      // -----------------------------------------------------------------------
      doc
        .moveTo(72, doc.y)
        .lineTo(280, doc.y)
        .strokeColor(COLORS.border)
        .stroke();

      doc
        .fillColor(COLORS.text)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('Vecta Compliance Officer', 72, doc.y + 6);
      doc
        .font('Helvetica')
        .fillColor(COLORS.muted)
        .fontSize(9)
        .text('Vecta Financial Services LLC', 72)
        .text('compliance@vecta.io  ·  (888) VECTA-01');

      // -----------------------------------------------------------------------
      // Footer
      // -----------------------------------------------------------------------
      const footerY = doc.page.height - 45;
      doc
        .rect(0, footerY, doc.page.width, 45)
        .fill(COLORS.primary);

      doc
        .fillColor(COLORS.white)
        .fontSize(8)
        .font('Helvetica')
        .text(
          `CONFIDENTIAL — This document is issued for housing application purposes only. Not for resale or redistribution.  ·  vecta.io`,
          72,
          footerY + 15,
          { align: 'center', width: doc.page.width - 144 },
        );

      doc.end();
    } catch (err) {
      logger.error({ err, locId: input.locId }, 'LoC PDF generation failed');
      reject(err);
    }
  });
}

// ---------------------------------------------------------------------------
// PDF layout helpers
// ---------------------------------------------------------------------------

function drawSectionHeader(doc: PDFKit.PDFDocument, title: string): void {
  doc
    .rect(doc.page.margins.left, doc.y, doc.page.width - doc.page.margins.left - doc.page.margins.right, 18)
    .fill(COLORS.primary);

  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(title, doc.page.margins.left + 8, doc.y - 14);

  doc.moveDown(1.2);
}

function drawTable(doc: PDFKit.PDFDocument, rows: [string, string][]): void {
  const leftX  = doc.page.margins.left;
  const rightX = doc.page.width - doc.page.margins.right;
  const colW   = 160;

  rows.forEach(([label, value], i) => {
    const rowY = doc.y;
    const isEven = i % 2 === 0;

    if (isEven) {
      doc
        .rect(leftX, rowY - 2, rightX - leftX, 16)
        .fill('#F9FAFB');
    }

    doc
      .fillColor(COLORS.muted)
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(label, leftX + 4, rowY, { width: colW, lineBreak: false });

    doc
      .fillColor(COLORS.text)
      .font('Helvetica')
      .text(value, leftX + colW + 8, rowY, {
        width: rightX - leftX - colW - 12,
        lineBreak: false,
      });

    doc.moveDown(0.9);
  });
}
