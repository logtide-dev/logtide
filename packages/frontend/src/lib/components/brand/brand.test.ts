import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { EXCEPTION_LANGUAGES } from '@logtide/shared';
import BrandIcon from './BrandIcon.svelte';
import { BRANDS } from './brands';
import { browserBrand, channelBrand, engineBrand, languageBrand, osBrand, platformBrand } from './brand-map';
import { PLATFORMS } from '$lib/components/connect/snippets';

describe('brand catalog', () => {
  it('has a valid colour and path for every mark', () => {
    for (const [slug, mark] of Object.entries(BRANDS)) {
      expect(mark.hex, slug).toMatch(/^[0-9A-F]{6}$/);
      expect(mark.path, slug).toMatch(/^[Mm][MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/);
    }
  });
});

describe('brand lookups', () => {
  it('maps every exception language except unknown', () => {
    for (const lang of EXCEPTION_LANGUAGES) {
      if (lang === 'unknown') expect(languageBrand(lang)).toBeNull();
      else expect(languageBrand(lang), lang).not.toBeNull();
    }
  });

  it('maps every connect platform', () => {
    for (const p of PLATFORMS) expect(platformBrand(p.id), p.id).not.toBeNull();
  });

  it('maps user agent browsers and operating systems case-insensitively', () => {
    expect(browserBrand('Chrome')).toBe('googlechrome');
    expect(browserBrand('Edge')).toBe('microsoftedge');
    expect(browserBrand('Firefox')).toBe('firefoxbrowser');
    expect(osBrand('macOS')).toBe('apple');
    expect(osBrand('iOS')).toBe('apple');
    expect(osBrand('Windows')).toBe('windows');
    expect(browserBrand('Lynx')).toBeNull();
    expect(osBrand(null)).toBeNull();
  });

  it('maps vendor channels and storage engines only', () => {
    expect(channelBrand('teams')).toBe('microsoftteams');
    expect(channelBrand('email')).toBeNull();
    expect(channelBrand('webhook')).toBeNull();
    expect(engineBrand('clickhouse')).toBe('clickhouse');
    expect(engineBrand('timescale')).toBe('timescale');
    expect(engineBrand('postgres')).toBeNull();
  });
});

describe('BrandIcon', () => {
  it('is decorative by default', () => {
    const { container } = render(BrandIcon, { props: { brand: 'go' } });
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('role')).toBeNull();
    expect(svg.getAttribute('style')).toContain('#00ADD8');
  });

  it('exposes an accessible name when given a title', () => {
    const { getByRole } = render(BrandIcon, { props: { brand: 'slack', title: 'Slack' } });
    expect(getByRole('img', { name: 'Slack' })).toBeTruthy();
  });

  it('falls back to the text colour in dark mode for dark marks only', () => {
    const dark = render(BrandIcon, { props: { brand: 'github' } }).container.querySelector('svg')!;
    const bright = render(BrandIcon, { props: { brand: 'python' } }).container.querySelector('svg')!;
    expect(dark.getAttribute('class')).toContain('dark:fill-current');
    expect(bright.getAttribute('class')).not.toContain('dark:fill-current');
  });
});
