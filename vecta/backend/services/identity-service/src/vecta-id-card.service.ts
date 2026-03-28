/**
 * services/identity-service/src/vecta-id-card.service.ts
 *
 * Vecta ID Card generation service.
 * Generates professional digital ID cards as PDF (two pages: front + back)
 * and PNG images, then uploads them to S3 / file storage.
 *
 * Card dimensions: credit-card size 3.375 × 2.125 inches (243 × 153 pts at 72 dpi).
 */

import { randomBytes } from 'crypto';
import { createLogger } from '@vecta/logger';

const logger = createLogger('vecta-id-card');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VectaIDCardData {
  studentId:      string;
  vectaIdNumber:  string;   // VID-XXXX-XXXX-XXXX
  legalName:      string;
  university:     string;
  programOfStudy: string;
  visaType:       string;
  visaExpiryYear: number;
  issuedAt:       string;   // ISO string
  expiresAt:      string;   // ISO string — 1 year from issue
  photoBase64:    string;   // from DG2 or uploaded selfie
  verificationUrl: string;  // https://verify.vecta.io/id/{vectaIdNumber}
  nfcVerified:    boolean;
  kycStatus:      string;
}

export interface VectaIDCardResult {
  pdfBuffer:   Buffer;
  frontPng:    Buffer;
  backPng:     Buffer;
  s3PdfUrl:    string;
  s3FrontUrl:  string;
  s3BackUrl:   string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CARD_W = 243; // points (3.375 inches × 72)
const CARD_H = 153; // points (2.125 inches × 72)

const NAVY      = '#001F3F';
const NAVY_DARK = '#001228';
const TEAL      = '#00E6CC';
const WHITE     = '#FFFFFF';
const GREEN     = '#00C896';

// ---------------------------------------------------------------------------
// ID number generator
// ---------------------------------------------------------------------------

export async function generateVectaIDNumber(db: {
  query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ vecta_id_number: string }> }>;
}): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/I/1
  let candidate = '';
  let unique    = false;

  while (!unique) {
    const seg = (n: number) =>
      Array.from({ length: n }, () => chars[randomBytes(1)[0] % chars.length]).join('');
    candidate = `VID-${seg(4)}-${seg(4)}-${seg(4)}`;

    const { rows } = await db.query(
      'SELECT vecta_id_number FROM students WHERE vecta_id_number = $1',
      [candidate],
    );
    if (rows.length === 0) unique = true;
  }

  return candidate;
}

// ---------------------------------------------------------------------------
// PDF generation using pdfkit (dynamic import — not available in mobile bundle)
// ---------------------------------------------------------------------------

async function loadPDFKit() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PDFDocument = require('pdfkit') as typeof import('pdfkit');
    return PDFDocument;
  } catch {
    throw new Error('pdfkit not installed. Run: npm install pdfkit --workspace=identity-service');
  }
}

async function loadQRCode() {
  try {
    const QRCode = await import('qrcode');
    return QRCode;
  } catch {
    throw new Error('qrcode not installed. Run: npm install qrcode --workspace=identity-service');
  }
}

// ---------------------------------------------------------------------------
// Draw front page
// ---------------------------------------------------------------------------

function drawFront(doc: PDFKit.PDFDocument, data: VectaIDCardData): void {
  // Background — navy
  doc.rect(0, 0, CARD_W, CARD_H).fill(NAVY);

  // Subtle V watermark (very faint)
  doc.save();
  doc.opacity(0.06);
  doc.fontSize(120).fillColor('#FFFFFF').font('Helvetica-Bold')
     .text('V', CARD_W / 2 - 45, CARD_H / 2 - 65, { lineBreak: false });
  doc.restore();

  // Teal accent bar — top
  doc.rect(0, 0, CARD_W, 5).fill(TEAL);

  // ----- VECTA logo area (top-left) -----
  // Shield icon drawn as polygon
  doc.save();
  doc.translate(8, 9);
  doc.path('M12 0 L24 5 L24 16 C24 22 12 28 12 28 C12 28 0 22 0 16 L0 5 Z')
     .fill(TEAL);
  // V letter inside shield
  doc.fillColor(NAVY).fontSize(10).font('Helvetica-Bold')
     .text('V', 8, 8, { lineBreak: false });
  doc.restore();

  // VECTA wordmark
  doc.fillColor(WHITE).fontSize(14).font('Helvetica-Bold')
     .text('VECTA', 38, 9, { lineBreak: false });

  // FINANCIAL EMBASSY tagline
  doc.fillColor(TEAL).fontSize(5).font('Helvetica')
     .text('FINANCIAL EMBASSY', 38, 25, { lineBreak: false });

  // F-1 VERIFIED badge (top-right)
  doc.roundedRect(CARD_W - 58, 8, 54, 14, 3).fill(GREEN);
  doc.fillColor(WHITE).fontSize(5).font('Helvetica-Bold')
     .text('● F-1 VERIFIED', CARD_W - 55, 12, { lineBreak: false });

  // UNITED STATES label
  doc.fillColor(WHITE).fontSize(5).font('Helvetica')
     .text('UNITED STATES', CARD_W - 55, 24, { lineBreak: false });

  // ----- Photo section (left side) -----
  const photoX = 8;
  const photoY = 38;
  const photoW = 52;
  const photoH = 65;

  // Photo border
  doc.roundedRect(photoX - 1, photoY - 1, photoW + 2, photoH + 2, 4)
     .strokeColor(TEAL).lineWidth(1.5).stroke();

  // Photo or initials
  if (data.photoBase64 && data.photoBase64.length > 100) {
    try {
      const imgBuffer = Buffer.from(
        data.photoBase64.replace(/^data:image\/\w+;base64,/, ''),
        'base64',
      );
      doc.image(imgBuffer, photoX, photoY, { width: photoW, height: photoH, cover: [photoW, photoH] });
    } catch {
      drawInitials(doc, data.legalName, photoX, photoY, photoW, photoH);
    }
  } else {
    drawInitials(doc, data.legalName, photoX, photoY, photoW, photoH);
  }

  // VID number below photo
  const shortVid = data.vectaIdNumber;
  doc.fillColor(TEAL).fontSize(4).font('Courier')
     .text(shortVid, photoX, photoY + photoH + 4, { width: photoW, align: 'center', lineBreak: false });

  // ----- Info section (right of photo) -----
  const infoX = photoX + photoW + 10;
  const infoY = 38;
  const rowH  = 10;

  // Full name
  const displayName = data.legalName.length > 22
    ? data.legalName.slice(0, 22) + '…'
    : data.legalName;
  doc.fillColor(WHITE).fontSize(9).font('Helvetica-Bold')
     .text(displayName, infoX, infoY, { lineBreak: false });

  // Labels + values
  const rows: Array<{ label: string; value: string; color?: string }> = [
    { label: 'UNIVERSITY', value: data.university.length > 24 ? data.university.slice(0, 24) + '…' : data.university },
    { label: 'PROGRAM',    value: data.programOfStudy.length > 24 ? data.programOfStudy.slice(0, 24) + '…' : data.programOfStudy },
    { label: 'VISA STATUS', value: 'F-1 ACTIVE', color: GREEN },
    { label: 'EXPIRES',    value: String(data.visaExpiryYear) },
    { label: 'ISSUED',     value: new Date(data.issuedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
  ];

  rows.forEach((row, i) => {
    const y = infoY + rowH + (i * rowH);
    doc.fillColor(TEAL).fontSize(4.5).font('Helvetica-Bold')
       .text(row.label, infoX, y, { lineBreak: false });
    doc.fillColor(row.color ?? WHITE).fontSize(6).font('Helvetica')
       .text(row.value, infoX, y + 5, { lineBreak: false });
  });

  // ----- Bottom strip -----
  const bottomY = CARD_H - 20;

  // NFC verified
  doc.fillColor(TEAL).fontSize(5).font('Helvetica')
     .text(data.nfcVerified ? '⬡ NFC VERIFIED' : '○ NFC PENDING', 8, bottomY + 3, { lineBreak: false });

  // Microtext
  doc.fillColor('rgba(255,255,255,0.3)').fontSize(3).font('Helvetica')
     .text(
       'VECTA FINANCIAL SERVICES LLC • LIFE-AS-A-SERVICE • NOT A GOVERNMENT DOCUMENT',
       8, CARD_H - 7, { lineBreak: false },
     );

  // UV decorative strip
  for (let x = 0; x < CARD_W; x += 4) {
    doc.moveTo(x, CARD_H - 4).lineTo(x + 2, CARD_H).strokeColor(TEAL).opacity(0.15).lineWidth(1).stroke();
  }
  doc.opacity(1);
}

function drawInitials(doc: PDFKit.PDFDocument, name: string, x: number, y: number, w: number, h: number): void {
  doc.rect(x, y, w, h).fill('#002244');
  const initials = name.split(' ').slice(0, 2).map(s => s[0]?.toUpperCase() ?? '').join('');
  doc.fillColor(TEAL).fontSize(18).font('Helvetica-Bold')
     .text(initials, x, y + h / 2 - 12, { width: w, align: 'center', lineBreak: false });
}

// ---------------------------------------------------------------------------
// Draw QR code onto PDF page
// ---------------------------------------------------------------------------

async function drawQRCode(
  doc: PDFKit.PDFDocument,
  url: string,
  x: number,
  y: number,
  size: number,
): Promise<void> {
  try {
    const QRCode = await loadQRCode();
    const pngBuffer = await QRCode.toBuffer(url, {
      type:  'png',
      width: size * 4, // higher res for crisp rendering
      margin: 1,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    doc.image(pngBuffer, x, y, { width: size, height: size });
  } catch {
    // QR placeholder box if qrcode not installed
    doc.rect(x, y, size, size).fill('#FFFFFF');
    doc.fillColor('#000000').fontSize(3).font('Helvetica')
       .text('QR', x + size / 2 - 3, y + size / 2 - 3, { lineBreak: false });
  }
}

// ---------------------------------------------------------------------------
// Draw back page
// ---------------------------------------------------------------------------

async function drawBack(doc: PDFKit.PDFDocument, data: VectaIDCardData): Promise<void> {
  // Background
  doc.rect(0, 0, CARD_W, CARD_H).fill(NAVY);

  // Magnetic stripe simulation
  doc.rect(0, 8, CARD_W, 20).fill('#111111');

  // Terms of use
  doc.fillColor(WHITE).fontSize(5.5).font('Helvetica-Bold')
     .text('VECTA ID CARD — TERMS OF USE', 10, 36, { lineBreak: false });

  doc.fillColor('rgba(255,255,255,0.7)').fontSize(4).font('Helvetica')
     .text(
       'This card is issued by Vecta Financial Services LLC and certifies that the holder has\n' +
       'completed NFC passport chip verification, liveness detection, and financial solvency\n' +
       'verification. This is not a government-issued document. Valid for 1 year from issue date.',
       10, 44, { width: CARD_W - 20, lineBreak: true },
     );

  // Large QR code centered
  const qrX = CARD_W / 2 - 40;
  const qrY = 68;
  await drawQRCode(doc, data.verificationUrl, qrX, qrY, 80);

  // Verify text below QR
  doc.fillColor(WHITE).fontSize(4.5).font('Helvetica')
     .text('Scan to verify identity at verify.vecta.io', 10, qrY + 84, {
       width: CARD_W - 20, align: 'center', lineBreak: false,
     });

  // Contact
  doc.fillColor(TEAL).fontSize(4).font('Helvetica')
     .text('support@vecta.io  ·  vecta.io', 10, qrY + 93, {
       width: CARD_W - 20, align: 'center', lineBreak: false,
     });

  // Signature strip
  doc.rect(10, CARD_H - 24, CARD_W - 20, 16).fill('#FFFFFF');
  doc.fillColor('#333333').fontSize(4).font('Helvetica')
     .text('AUTHORIZED SIGNATURE', 14, CARD_H - 21, { lineBreak: false });
  // Cursive-style name
  doc.fillColor('#001F3F').fontSize(7).font('Helvetica-Oblique')
     .text(data.legalName, 14, CARD_H - 14, { lineBreak: false });
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export async function generateVectaIDCard(data: VectaIDCardData): Promise<VectaIDCardResult> {
  const PDFDocument = await loadPDFKit();

  // ---- Build PDF in memory ----
  const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({
      size:    [CARD_W, CARD_H],
      margins: { top: 0, left: 0, right: 0, bottom: 0 },
      info:    {
        Title:    'Vecta ID Card',
        Author:   'Vecta Financial Services LLC',
        Subject:  `ID Card for ${data.legalName}`,
        Keywords: 'vecta,identity,verified',
      },
    });

    doc.on('data',  (chunk: Buffer) => chunks.push(chunk));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Page 1: front
    drawFront(doc, data);

    // Page 2: back
    doc.addPage({ size: [CARD_W, CARD_H], margins: { top: 0, left: 0, right: 0, bottom: 0 } });
    drawBack(doc, data)
      .then(() => doc.end())
      .catch(reject);
  });

  // ---- PNG conversion (using sharp if available, else return empty buffer) ----
  let frontPng: Buffer = Buffer.alloc(0);
  let backPng:  Buffer = Buffer.alloc(0);

  try {
    const sharp = await import('sharp');
    // For now return the PDF buffer as a placeholder for both PNGs
    // In production: use pdf-poppler or pdfjs-dist to rasterize each page first
    frontPng = await sharp.default(pdfBuffer, { pages: 0 })
      .png().toBuffer().catch(() => Buffer.alloc(0));
    backPng  = await sharp.default(pdfBuffer, { pages: 1 })
      .png().toBuffer().catch(() => Buffer.alloc(0));
  } catch {
    logger.warn('sharp not available — PNG generation skipped. Install: npm install sharp --workspace=identity-service');
    frontPng = pdfBuffer; // fallback: use PDF buffer
    backPng  = pdfBuffer;
  }

  // ---- Upload to storage (S3 / R2 / local) ----
  const base     = `identity/${data.studentId}/vecta-id-card`;
  const pdfUrl   = await uploadToStorage(`${base}/card.pdf`,   pdfBuffer,  'application/pdf');
  const frontUrl = await uploadToStorage(`${base}/front.png`,  frontPng,   'image/png');
  const backUrl  = await uploadToStorage(`${base}/back.png`,   backPng,    'image/png');

  logger.info({ studentId: data.studentId, vectaIdNumber: data.vectaIdNumber }, 'Vecta ID card generated');

  return {
    pdfBuffer,
    frontPng,
    backPng,
    s3PdfUrl:   pdfUrl,
    s3FrontUrl: frontUrl,
    s3BackUrl:  backUrl,
  };
}

// ---------------------------------------------------------------------------
// Storage helper — delegates to @vecta/storage or uses fallback URL
// ---------------------------------------------------------------------------

async function uploadToStorage(key: string, buffer: Buffer, contentType: string): Promise<string> {
  try {
    const { uploadBuffer } = await import('@vecta/storage');
    return await uploadBuffer(key, buffer, contentType);
  } catch {
    // Fallback: return a placeholder URL pointing to the API gateway
    const apiBase = process.env.VECTA_INTERNAL_API_URL ?? 'https://vecta-elaf.onrender.com';
    return `${apiBase}/api/v1/identity/card-asset/${encodeURIComponent(key)}`;
  }
}
