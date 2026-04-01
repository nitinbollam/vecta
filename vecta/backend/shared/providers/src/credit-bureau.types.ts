/**
 * Bureau score shape for credit-bureau adapter stubs in this package.
 * Keeps providers from importing housing-service (avoids pulling the whole monorepo graph into tsc).
 */
export interface BureauScore {
  score:      number;
  range:      { min: number; max: number };
  bureau:     string;
  reportDate: Date;
  factors?:   string[];
}
