const HEX = /^#[0-9a-fA-F]{6}$/;

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two #rrggbb colours, or null for invalid input. */
export function contrastRatio(a: string, b: string): number | null {
  if (!HEX.test(a) || !HEX.test(b)) return null;
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const DARK = '#111827';
const LIGHT = '#ffffff';

/** Text colour that stays readable on the given background, null for invalid hex. */
export function readableForeground(hex: string): typeof DARK | typeof LIGHT | null {
  const withDark = contrastRatio(hex, DARK);
  const withLight = contrastRatio(hex, LIGHT);
  if (withDark === null || withLight === null) return null;
  return withDark >= withLight ? DARK : LIGHT;
}
