/**
 * apps/student-app/src/constants/design.ts
 * 
 * Re-export shim so existing imports from "@/constants/design" still work.
 * All values now derive from the canonical brand identity:
 *   #001F3F (deep navy) · #001A33 (dark navy) · #00E6CC (teal)
 */

export {
  VectaColors,
  VectaFonts,
  VectaSpacing,
  VectaRadius,
  VectaShadows,
  VectaGradients,
} from './theme';

// Legacy aliases used by older screens
export const VectaColorLegacy = {
  primary:       '#001F3F',
  primaryLight:  '#003060',
  accent:        '#00E6CC',
  gradientStart: '#001F3F',
  gradientEnd:   '#001A33',
  background:    '#F4F4F4',
  cardBg:        '#FFFFFF',
  text:          '#001F3F',
  textMuted:     '#7A9BAD',
};
