export interface ParsedUserAgent {
  browser?: string;
  os?: string;
  device?: 'desktop' | 'mobile' | 'tablet';
}

// Order matters: Edge, Opera and Chrome iOS all carry a Chrome or Safari token.
const BROWSERS: Array<[RegExp, string]> = [
  [/\b(Edg|EdgA|EdgiOS|Edge)\//, 'Edge'],
  [/\b(OPR|Opera|OPiOS)\//, 'Opera'],
  [/\b(Firefox|FxiOS)\//, 'Firefox'],
  [/\b(Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const OPERATING_SYSTEMS: Array<[RegExp, string]> = [
  [/\bWindows\b/, 'Windows'],
  [/\b(iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\b(Macintosh|Mac OS X)\b/, 'macOS'],
  [/\b(Linux|X11|CrOS)\b/, 'Linux'],
];

/**
 * Small regex based user agent parser for session lists. Deliberately
 * coarse: browser family, OS family and device class only.
 */
export function parseUserAgent(ua: string | undefined | null): ParsedUserAgent {
  if (!ua || typeof ua !== 'string') return {};

  const result: ParsedUserAgent = {};

  for (const [re, name] of BROWSERS) {
    if (re.test(ua)) {
      result.browser = name;
      break;
    }
  }
  for (const [re, name] of OPERATING_SYSTEMS) {
    if (re.test(ua)) {
      result.os = name;
      break;
    }
  }

  if (!result.browser && !result.os) return {};

  if (/\b(iPad|Tablet)\b/.test(ua) || (/\bAndroid\b/.test(ua) && !/\bMobile\b/.test(ua))) {
    result.device = 'tablet';
  } else if (/\b(iPhone|iPod|Mobile)\b/.test(ua)) {
    result.device = 'mobile';
  } else {
    result.device = 'desktop';
  }

  return result;
}
