import * as path from 'path';

/**
 * Dynamic `import()` using a runtime path so `tsc` does not statically pull
 * banking/housing services into the @vecta/providers compilation graph.
 */
export async function importBankingServiceModule(
  file: 'vecta-ledger.service' | 'vecta-connect.service',
): Promise<Record<string, unknown>> {
  const modPath = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'services',
    'banking-service',
    'src',
    file,
  );
  return (await import(modPath)) as Record<string, unknown>;
}

export async function importHousingCreditBridgeModule(): Promise<Record<string, unknown>> {
  const modPath = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'services',
    'housing-service',
    'src',
    'vecta-credit-bridge.service',
  );
  return (await import(modPath)) as Record<string, unknown>;
}
