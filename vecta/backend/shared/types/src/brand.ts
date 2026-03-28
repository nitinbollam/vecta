/**
 * packages/types/src/brand.ts
 * Vecta brand identity tokens — single source of truth.
 * Colors: #001F3F · #001A33 · #00E6CC · #F4F4F4 · #FFFFFF
 */
export const VectaBrand = {
  colors: {
    navyDeep:  '#001F3F',
    navy:      '#001A33',
    teal:      '#00E6CC',
    tealDim:   '#00B8A4',
    light:     '#F4F4F4',
    white:     '#FFFFFF',
  },
  tagline:   'Financial Embassy & Life-as-a-Service',
  company:   'Vecta Financial Services LLC',
  issuer:    'Vecta Financial Services LLC',
  supportEmail: 'support@vecta.io',
  landlordEmail: 'landlords@vecta.io',
  partnerEmail: 'partnerships@vecta.io',
} as const;
