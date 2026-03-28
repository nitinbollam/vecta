export declare function sendStudentMagicLinkEmail(params: {
  toEmail: string;
  magicLinkUrl: string;
  studentName?: string;
}): Promise<void>;

export declare function sendLandlordVerifyEmail(params: {
  toEmail: string;
  toName?: string;
  verifyUrl: string;
}): Promise<void>;

export declare function sendLandlordUpgradeEmail(params: {
  toEmail: string;
  toName?: string;
}): Promise<void>;

export declare function sendStudentTokenUsedEmail(params: {
  toEmail: string;
  studentName: string;
  usedAt: Date;
  tokensUrl: string;
}): Promise<void>;

export declare function sendKycApprovedEmail(params: {
  toEmail: string;
  studentName: string;
}): Promise<void>;

export declare function sendKycRejectedEmail(params: {
  toEmail: string;
  studentName: string;
  rejectReason: string;
  retryUrl: string;
}): Promise<void>;

export declare function sendLocReadyEmail(params: {
  toEmail: string;
  studentName: string;
  locId: string;
  expiresAt: Date;
  pdfUrl?: string;
}): Promise<void>;
