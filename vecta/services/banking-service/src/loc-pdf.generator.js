"use strict";
/**
 * Minimal Plaid / banking Letter of Credit PDF (banking-service).
 * Housing-service has a richer template; this covers the Plaid solvency flow only.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateLocPDF = generateLocPDF;
const pdfkit_1 = __importDefault(require("pdfkit"));
const logger_1 = require("@vecta/logger");
const logger = (0, logger_1.createLogger)('banking-loc-pdf');
async function generateLocPDF(input) {
    return new Promise((resolve, reject) => {
        try {
            const chunks = [];
            const doc = new pdfkit_1.default({ margin: 50 });
            doc.on('data', (c) => chunks.push(c));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);
            doc.fontSize(18).text('Vecta — Letter of Credit', { align: 'center' });
            doc.moveDown();
            doc.fontSize(10).text(`Student: ${input.studentFullName}`);
            doc.text(`University: ${input.universityName}`);
            if (input.landlordName)
                doc.text(`Landlord: ${input.landlordName}`);
            doc.moveDown();
            doc.text(`Report ID: ${input.reportId}`);
            doc.text(`Guaranteed months: ${input.guaranteedMonths}`);
            doc.text(`Issued: ${input.generatedAt}`);
            doc.moveDown();
            doc.text(input.guaranteeStatement);
            doc.moveDown();
            doc.font('Courier').fontSize(8).text(`HMAC integrity: ${input.cryptographicHash}`);
            doc.end();
        }
        catch (err) {
            logger.error({ err }, 'LoC PDF generation failed');
            reject(err);
        }
    });
}
//# sourceMappingURL=loc-pdf.generator.js.map