export const SERVICE_REGISTRY = {
  identity: {
    name: 'identity-service',
    url:  process.env.IDENTITY_SERVICE_URL ?? 'http://localhost:3001',
    timeout: 30000,
  },
  banking: {
    name: 'banking-service',
    url:  process.env.BANKING_SERVICE_URL ?? 'http://localhost:3002',
    timeout: 30000,
  },
  housing: {
    name: 'housing-service',
    url:  process.env.HOUSING_SERVICE_URL ?? 'http://localhost:3003',
    timeout: 30000,
  },
  mobility: {
    name: 'mobility-service',
    url:  process.env.MOBILITY_SERVICE_URL ?? 'http://localhost:3004',
    timeout: 30000,
  },
  compliance: {
    name: 'compliance-service',
    url:  process.env.COMPLIANCE_SERVICE_URL ?? 'http://localhost:3005',
    timeout: 30000,
  },
  audit: {
    name: 'audit-service',
    url:  process.env.AUDIT_SERVICE_URL ?? 'http://localhost:3006',
    timeout: 30000,
  },
  'compliance-ai': {
    name: 'compliance-ai',
    url:  process.env.COMPLIANCE_AI_URL ?? 'http://localhost:3007',
    timeout: 60000,
  },
} as const;
