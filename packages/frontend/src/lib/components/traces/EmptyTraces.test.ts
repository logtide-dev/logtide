import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/config', () => ({ getApiUrl: () => 'https://logs.example.com' }));
const copy = vi.fn(async (_value: string) => true);
vi.mock('$lib/utils/clipboard', () => ({ copyToClipboard: (v: string) => copy(v) }));

import { render, screen, fireEvent } from '@testing-library/svelte';
import EmptyTraces from '$lib/components/EmptyTraces.svelte';

describe('EmptyTraces', () => {
  it('renders the setup empty state with the shared connect snippets', async () => {
    const { container } = render(EmptyTraces);
    expect(screen.getByText('No traces yet')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Platform' })).toBeInTheDocument();
    expect(container.textContent).toContain('https://logs.example.com/v1/otlp/traces');
  });

  it('defaults to the OpenTelemetry platform', () => {
    render(EmptyTraces);
    expect(screen.getByRole('radio', { name: 'OpenTelemetry OTLP' })).toHaveAttribute('aria-checked', 'true');
  });

  it('copy button copies a snippet with the OTLP traces endpoint', async () => {
    render(EmptyTraces);
    await fireEvent.click(screen.getAllByRole('button', { name: /^Copy / })[0]);
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy.mock.calls[0][0]).toContain('https://logs.example.com/v1/otlp/traces');
  });

  it('has no icon-only button without an aria-label', () => {
    const { container } = render(EmptyTraces);
    for (const button of container.querySelectorAll('button')) {
      const hasName = (button.textContent ?? '').trim().length > 0 || button.hasAttribute('aria-label');
      expect(hasName).toBe(true);
    }
  });
});
