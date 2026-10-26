import type { BrandSlug } from './brands';

// Lookups from the identifiers used across the app to a brand mark.
// Anything without a mark returns null and callers fall back to text only.

const LANGUAGES: Record<string, BrandSlug> = {
  nodejs: 'nodedotjs',
  javascript: 'javascript',
  python: 'python',
  java: 'openjdk',
  go: 'go',
  php: 'php',
  kotlin: 'kotlin',
  csharp: 'csharp',
  dotnet: 'dotnet',
  rust: 'rust',
  ruby: 'ruby',
};

/** Exception languages (`EXCEPTION_LANGUAGES`) and SDK languages. */
export function languageBrand(language: string | null | undefined): BrandSlug | null {
  return (language && LANGUAGES[language.toLowerCase()]) || null;
}

const PLATFORMS: Record<string, BrandSlug> = {
  ...LANGUAGES,
  browser: 'javascript',
  otlp: 'opentelemetry',
  'fluent-bit': 'fluentbit',
  curl: 'curl',
};

/** Platforms of the connect / project setup snippets. */
export function platformBrand(platform: string | null | undefined): BrandSlug | null {
  return (platform && PLATFORMS[platform]) || null;
}

const BROWSERS: Record<string, BrandSlug> = {
  chrome: 'googlechrome',
  chromium: 'googlechrome',
  edge: 'microsoftedge',
  firefox: 'firefoxbrowser',
  safari: 'safari',
  opera: 'opera',
};

/** Browser names as parsed from the user agent (sessions). */
export function browserBrand(browser: string | null | undefined): BrandSlug | null {
  return (browser && BROWSERS[browser.toLowerCase()]) || null;
}

const OPERATING_SYSTEMS: Record<string, BrandSlug> = {
  windows: 'windows',
  macos: 'apple',
  ios: 'apple',
  android: 'android',
  linux: 'linux',
};

/** Operating system names as parsed from the user agent (sessions). */
export function osBrand(os: string | null | undefined): BrandSlug | null {
  return (os && OPERATING_SYSTEMS[os.toLowerCase()]) || null;
}

const CHANNELS: Record<string, BrandSlug> = {
  slack: 'slack',
  teams: 'microsoftteams',
  discord: 'discord',
  pagerduty: 'pagerduty',
};

/** Notification channel destination types; email and webhook have no brand. */
export function channelBrand(type: string | null | undefined): BrandSlug | null {
  return (type && CHANNELS[type]) || null;
}

const ENGINES: Record<string, BrandSlug> = {
  timescale: 'timescale',
  timescaledb: 'timescale',
  clickhouse: 'clickhouse',
  mongodb: 'mongodb',
};

/** Storage engines behind the reservoir. */
export function engineBrand(engine: string | null | undefined): BrandSlug | null {
  return (engine && ENGINES[engine.toLowerCase()]) || null;
}
