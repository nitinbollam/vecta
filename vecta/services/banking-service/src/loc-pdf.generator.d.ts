/**
 * Minimal Plaid / banking Letter of Credit PDF (banking-service).
 * Housing-service has a richer template; this covers the Plaid solvency flow only.
 */
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
export declare function generateLocPDF(input: BankingLocPdfInput): Promise<Buffer>;
//# sourceMappingURL=loc-pdf.generator.d.ts.map