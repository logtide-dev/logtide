import { describe, it, expect, vi, afterEach } from 'vitest';
import { exportIncidentToPdf, formatShortDate } from './siem';
import { displayPreferences } from '$lib/stores/display-preferences';
import { severityTone } from './severity';

function captureExport() {
  const write = vi.fn();
  vi.stubGlobal('window', {
    ...window,
    open: () => ({ document: { write, close: vi.fn() }, print: vi.fn(), onload: null }),
  });
  return write;
}

describe('incident export severity colours', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('takes the badge colours from the severity module, not hard-coded hex', async () => {
    const write = captureExport();
    await exportIncidentToPdf({
      incident: { title: 'T', severity: 'medium', status: 'open' } as never,
      detections: [],
      comments: [],
      history: [],
    });
    const html = write.mock.calls[0][0] as string;
    expect(html).not.toContain('#f97316');
    expect(html).not.toContain('#eab308');
    for (const sev of ['critical', 'high', 'medium', 'low', 'informational']) {
      expect(html).toContain(`.badge-${sev} { background: ${severityTone(sev).chart};`);
    }
  });
});

describe('incident export times (UI-9)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('formats times in the display zone and clock with a zone label', async () => {
    displayPreferences.set({ hour12: false, timeZone: 'UTC' });
    const write = captureExport();
    await exportIncidentToPdf({
      incident: {
        title: 'T',
        severity: 'medium',
        status: 'open',
        createdAt: '2026-03-05T14:30:00.000Z',
      } as never,
      detections: [],
      comments: [{ createdAt: '2026-03-05T21:07:00.000Z', content: 'c', userName: 'u' }] as never,
      history: [],
    });
    const html = write.mock.calls[0][0] as string;
    expect(html).toContain('Mar 5, 14:30 UTC');
    expect(html).toContain('Mar 5, 21:07 UTC');
    expect(html).not.toMatch(/\b(AM|PM)\b/);
  });

  it('follows a 12 hour clock preference', () => {
    displayPreferences.set({ hour12: true, timeZone: 'UTC' });
    expect(formatShortDate('2026-03-05T21:07:00.000Z')).toMatch(/9:07 PM UTC$/);
  });
});
