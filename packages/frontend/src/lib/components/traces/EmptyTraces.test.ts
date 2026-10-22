import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/config', () => ({ getApiUrl: () => 'https://logs.example.com' }));
const copy = vi.fn(async () => true);
vi.mock('$lib/utils/clipboard', () => ({ copyToClipboard: (v: string) => copy(v) }));

import { render, screen, fireEvent } from '@testing-library/svelte';
import EmptyTraces from '$lib/components/EmptyTraces.svelte';

describe('EmptyTraces', () => {
  it('renders the setup empty state with the OTLP endpoint from getApiUrl', async () => {
    const { container } = render(EmptyTraces);
    expect(screen.getByText('No traces yet')).toBeInTheDocument();
    expect(container.textContent).toContain('https://logs.example.com/v1/otlp/traces');
  });

  it('copy button copies the active snippet', async () => {
    render(EmptyTraces);
    await fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(copy).toHaveBeenCalledTimes(1);
    const copied = copy.mock.calls[0][0] as unknown as string;
    expect(copied).toContain('NodeSDK');
    expect(copied).toContain('https://logs.example.com/v1/otlp/traces');
  });

  it('has no icon-only button without an aria-label', () => {
    const { container } = render(EmptyTraces);
    for (const button of container.querySelectorAll('button')) {
      const hasName = (button.textContent ?? '').trim().length > 0 || button.hasAttribute('aria-label');
      expect(hasName).toBe(true);
    }
  });
});
