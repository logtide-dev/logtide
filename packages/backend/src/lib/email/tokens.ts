/**
 * Email color tokens, copied from the LogTide Pannello design system (the
 * app's light and dark themes) as hex: email clients do not read CSS variables
 * and Outlook ignores rgba, so every 15% / 30% status tint is precomputed.
 */

export interface EmailPalette {
  ground: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  track: string;
  key: string;
  button: string;
  buttonText: string;
  error: string;
  errorSolid: string;
  errorFill: string;
  errorLine: string;
  success: string;
  successSolid: string;
  successFill: string;
  successLine: string;
  warning: string;
  warningSolid: string;
  warningFill: string;
  warningLine: string;
  info: string;
  infoSolid: string;
  infoFill: string;
  infoLine: string;
  critical: string;
  criticalSolid: string;
  criticalFill: string;
  criticalLine: string;
  neutral: string;
  neutralSolid: string;
  neutralFill: string;
  neutralLine: string;
}

export const light: EmailPalette = {
  ground: '#f3f4f6',
  card: '#ffffff',
  border: '#cbcfd7',
  text: '#030712',
  muted: '#5d636f',
  track: '#dcdfe5',
  key: '#5b14d7',
  button: '#7c3aed',
  buttonText: '#ffffff',
  error: '#af1d1d',
  errorSolid: '#ef4444',
  errorFill: '#fde3e3',
  errorLine: '#fac7c7',
  success: '#137236',
  successSolid: '#157e3c',
  successFill: '#dcece2',
  successLine: '#b9d8c5',
  warning: '#8b4c04',
  warningSolid: '#d78c09',
  warningFill: '#f9eeda',
  warningLine: '#f3ddb5',
  info: '#0f52bd',
  infoSolid: '#156bf4',
  infoFill: '#dce9fd',
  infoLine: '#b9d3fc',
  critical: '#6e1bbb',
  criticalSolid: '#8821e8',
  criticalFill: '#edddfb',
  criticalLine: '#dbbcf8',
  neutral: '#5d636f',
  neutralSolid: '#6b7280',
  neutralFill: '#e5e7eb',
  neutralLine: '#cbcfd7',
};

export const dark: EmailPalette = {
  ground: '#09090b',
  card: '#101013',
  border: '#26262b',
  text: '#fafafa',
  muted: '#a1a1aa',
  track: '#3f3f46',
  key: '#be92fc',
  button: '#7c3aed',
  buttonText: '#f8fafc',
  error: '#f87777',
  errorSolid: '#ef4444',
  errorFill: '#2f1719',
  errorLine: '#502022',
  success: '#52e086',
  successSolid: '#28bd5f',
  successFill: '#142a1e',
  successLine: '#17442a',
  warning: '#fabd42',
  warningSolid: '#f6a823',
  warningFill: '#332715',
  warningLine: '#553e18',
  info: '#74b1fb',
  infoSolid: '#468af6',
  infoFill: '#182235',
  infoLine: '#203557',
  critical: '#c792fc',
  criticalSolid: '#b063f8',
  criticalFill: '#281c35',
  criticalLine: '#402958',
  neutral: '#a1a1aa',
  neutralSolid: '#6b7280',
  neutralFill: '#222226',
  neutralLine: '#26262b',
};

export type Tone = 'error' | 'success' | 'warning' | 'info' | 'critical' | 'neutral';

export const TONES: Tone[] = ['error', 'success', 'warning', 'info', 'critical', 'neutral'];

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'informational';

/** Severity to tone, as utils/severity.ts maps levels in the app. */
export function severityTone(severity: Severity): Tone {
  switch (severity) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
      return 'info';
    default:
      return 'neutral';
  }
}

/** The text, solid, fill and line colors of a tone in one palette. */
export function toneColors(p: EmailPalette, tone: Tone): { text: string; solid: string; fill: string; line: string } {
  return {
    text: p[tone],
    solid: p[`${tone}Solid`],
    fill: p[`${tone}Fill`],
    line: p[`${tone}Line`],
  };
}

export const FONT_SANS = "Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const FONT_MONO = "'JetBrains Mono', Menlo, Consolas, monospace";
