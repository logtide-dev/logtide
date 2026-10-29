import { describe, it, expect, vi, afterEach } from 'vitest';

import { render, screen } from '@testing-library/svelte';
import EmptyLogs from './EmptyLogs.svelte';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EmptyLogs', () => {
  it('uses sentence case copy', () => {
    render(EmptyLogs);
    expect(screen.getByRole('heading', { name: 'No logs yet' })).toBeTruthy();
    expect(screen.getByText('Get API key')).toBeTruthy();
    expect(screen.getByText('Read docs')).toBeTruthy();
    expect(screen.getByText('Quick start')).toBeTruthy();
    expect(screen.queryByText(/No Logs Yet|Get API Key|Read Docs|Quick Start/)).toBeNull();
  });

  it('renders the shared connect snippets and no hand-built DSN', () => {
    const { container } = render(EmptyLogs);
    expect(screen.getByRole('radiogroup', { name: 'Platform' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Copy /i }).length).toBeGreaterThan(0);
    expect(container.innerHTML).not.toContain('https://YOUR_API_KEY');
  });

  it('uses no raw palette colours', () => {
    const { container } = render(EmptyLogs);
    expect(container.innerHTML).not.toMatch(/\btext-(red|green|yellow|blue|purple|orange)-\d{3}\b/);
  });
});
