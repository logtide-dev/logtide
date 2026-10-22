import { describe, it, expect, vi, afterEach } from 'vitest';
import { exportIncidentToPdf } from './siem';
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
