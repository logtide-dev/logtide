import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { copyToClipboard } = vi.hoisted(() => ({ copyToClipboard: vi.fn() }));
vi.mock('$lib/utils/clipboard', () => ({ copyToClipboard }));

import ConnectSnippets from './ConnectSnippets.svelte';

const base = { apiUrl: 'https://logs.example.com', origin: 'https://logs.example.com' };

beforeEach(() => {
  copyToClipboard.mockReset();
  copyToClipboard.mockResolvedValue(true);
});

describe('ConnectSnippets', () => {
  it('renders eleven platform options', () => {
    render(ConnectSnippets, { ...base, apiKey: null });
    expect(screen.getAllByRole('radio')).toHaveLength(11);
    expect(screen.getByRole('radiogroup', { name: 'Platform' })).toBeInTheDocument();
  });

  it('switching platform changes the snippets', async () => {
    render(ConnectSnippets, { ...base, apiKey: null });
    expect(document.body.textContent).toContain('npm install @logtide/core');
    await fireEvent.click(screen.getByRole('radio', { name: 'Python' }));
    expect(document.body.textContent).toContain('pip install logtide-sdk');
    expect(document.body.textContent).not.toContain('npm install @logtide/core');
  });

  it('uses the placeholder when apiKey is null and the real key when given', async () => {
    const { unmount } = render(ConnectSnippets, { ...base, apiKey: null });
    expect(document.body.textContent).toContain('YOUR_API_KEY');
    unmount();
    render(ConnectSnippets, { ...base, apiKey: 'lp_realkey' });
    expect(document.body.textContent).toContain('lp_realkey');
    expect(document.body.textContent).not.toContain('YOUR_API_KEY');
  });

  it('copy button copies the snippet text', async () => {
    render(ConnectSnippets, { ...base, apiKey: 'lp_realkey' });
    await fireEvent.click(screen.getByRole('button', { name: 'Copy install' }));
    expect(copyToClipboard).toHaveBeenCalledWith('npm install @logtide/core');
  });

  it('moves selection with arrow keys', async () => {
    render(ConnectSnippets, { ...base, apiKey: null });
    const first = screen.getByRole('radio', { name: 'Node.js' });
    await fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Python' })).toHaveAttribute('aria-checked', 'true');
  });
});
