/**
 * Minimal Plaid / banking Letter of Credit PDF (banking-service).
 * Housing-service has a richer template; this covers the Plaid solvency flow only.
 */

import PDFDocument from 'pdfkit';
import { createLogger } from '@vecta/logger';

const logger = createLogger('banking-loc-pdf');

export interface BankingLocPdfInput {
  studentFullName: string;
  universityName: string;
  landlordName?: string;
  reportId: string;
  guaranteedMonths: number;
  guaranteeStatement: string;
  cryptographicHash: string;
  generatedAt: string;
}

export async function generateLocPDF(input: BankingLocPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({ margin: 50 });
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).text('Vecta — Letter of Credit', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10).text(`Student: ${input.studentFullName}`);
      doc.text(`University: ${input.universityName}`);
      if (input.landlordName) doc.text(`Landlord: ${input.landlordName}`);
      doc.moveDown();
      doc.text(`Report ID: ${input.reportId}`);
      doc.text(`Guaranteed months: ${input.guaranteedMonths}`);
      doc.text(`Issued: ${input.generatedAt}`);
      doc.moveDown();
      doc.text(input.guaranteeStatement);
      doc.moveDown();
      doc.font('Courier').fontSize(8).text(`HMAC integrity: ${input.cryptographicHash}`);
      doc.end();
    } catch (err) {
      logger.error({ err }, 'LoC PDF generation failed');
      reject(err);
    }
  });
}
