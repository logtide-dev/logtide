import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import type { SigmaRulePreviewResult } from '@logtide/shared';

const previewRule = vi.hoisted(() => vi.fn());

vi.mock('$lib/api/sigma', () => {
  class SigmaApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { sigmaAPI: { previewRule }, SigmaApiError };
});

import { SigmaApiError } from '$lib/api/sigma';
import RulePreviewPanel from './RulePreviewPanel.svelte';

function result(over: Partial<SigmaRulePreviewResult> = {}): SigmaRulePreviewResult {
  return {
    range: '24h',
    from: '2026-10-19T10:00:00.000Z',
    to: '2026-10-20T10:00:00.000Z',
    scanned: 12345,
    matches: 2,
    suppressed: 0,
    truncated: false,
    truncatedReason: null,
    samples: [
      {
        id: 'log-1',
        time: '2026-10-20T09:00:00.000Z',
        projectId: 'proj-1',
        service: 'auth',
        level: 'error',
        message: 'Failed login for admin',
        matchedFields: { user: 'admin' },
      },
    ],
    ...over,
  };
}

const props = { organizationId: 'org-1', ruleId: 'rule-1' };

beforeEach(() => {
  previewRule.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('RulePreviewPanel', () => {
  it('run posts the selected range and renders counts en-US', async () => {
    previewRule.mockResolvedValue(result());
    render(RulePreviewPanel, props);
    await fireEvent.click(screen.getByRole('radio', { name: '7 days' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    expect(previewRule).toHaveBeenCalledWith('rule-1', { organizationId: 'org-1', range: '7d' });
    expect(await screen.findByText('2 matches in 12,345 logs scanned')).toBeInTheDocument();
    expect(screen.getByText('Failed login for admin')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in Logs' }).getAttribute('href')).toContain(
      'logId=log-1',
    );
  });

  it('partial scan badge shows the max_logs reason', async () => {
    previewRule.mockResolvedValue(result({ truncated: true, truncatedReason: 'max_logs' }));
    render(RulePreviewPanel, props);
    await fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    expect(await screen.findByText('Partial scan')).toBeInTheDocument();
    expect(screen.getByText('Scanned the 50,000 most recent logs')).toBeInTheDocument();
  });

  it('partial scan badge shows the timeout reason', async () => {
    previewRule.mockResolvedValue(result({ truncated: true, truncatedReason: 'timeout' }));
    render(RulePreviewPanel, props);
    await fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    expect(await screen.findByText('Stopped after 30 seconds')).toBeInTheDocument();
  });

  it('shows suppressed line only when positive', async () => {
    previewRule.mockResolvedValue(result({ suppressed: 1234 }));
    const { unmount } = render(RulePreviewPanel, props);
    await fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    expect(await screen.findByText('1,234 suppressed by exceptions')).toBeInTheDocument();
    unmount();

    previewRule.mockResolvedValue(result({ suppressed: 0 }));
    render(RulePreviewPanel, props);
    await fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    await screen.findByText('2 matches in 12,345 logs scanned');
    expect(screen.queryByText(/suppressed by exceptions/)).toBeNull();
  });

  it('429 shows the already running message', async () => {
    previewRule.mockRejectedValue(new SigmaApiError('busy', 429));
    render(RulePreviewPanel, props);
    await fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    expect(
      await screen.findByText('A preview is already running, try again in a moment'),
    ).toBeInTheDocument();
  });

  it('includes yaml when a draft getter returns text', async () => {
    previewRule.mockResolvedValue(result());
    render(RulePreviewPanel, { ...props, getDraftYaml: () => 'title: Draft' });
    await fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    expect(previewRule).toHaveBeenCalledWith('rule-1', {
      organizationId: 'org-1',
      range: '24h',
      yaml: 'title: Draft',
    });
  });

  it('omits yaml when the draft getter returns null', async () => {
    previewRule.mockResolvedValue(result());
    render(RulePreviewPanel, { ...props, getDraftYaml: () => null });
    await fireEvent.click(screen.getByRole('button', { name: 'Run preview' }));
    expect(previewRule.mock.calls[0][1]).not.toHaveProperty('yaml');
  });
});
