import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import PublicStatusHeader from './PublicStatusHeader.svelte';

function renderHeader(props: Record<string, unknown> = {}) {
  return render(PublicStatusHeader, {
    props: {
      title: 'Acme status',
      description: null,
      logoUrl: null,
      accentColor: null,
      subscribeHref: '#subscribe',
      ...props,
    },
  });
}

describe('PublicStatusHeader', () => {
  it('shows the title and description', () => {
    renderHeader({ description: 'Live service health' });
    expect(screen.getByRole('heading', { name: 'Acme status' })).toBeInTheDocument();
    expect(screen.getByText('Live service health')).toBeInTheDocument();
  });

  it('falls back to the title when the logo fails to load', async () => {
    renderHeader({ logoUrl: 'https://example.com/logo.png' });
    const img = screen.getByRole('img', { name: 'Acme status' });
    expect(img).toBeInTheDocument();
    await fireEvent.error(img);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    const heading = screen.getByRole('heading', { name: 'Acme status' });
    expect(heading.className).not.toContain('sr-only');
  });

  it('uses white text on a dark accent button and dark text on a light accent', () => {
    const dark = renderHeader({ accentColor: '#0f172a' });
    const darkButton = screen.getByRole('link', { name: 'Subscribe to updates' });
    expect(darkButton.style.color).toBe('rgb(255, 255, 255)');
    expect(darkButton.style.backgroundColor).toBe('rgb(15, 23, 42)');
    dark.unmount();

    renderHeader({ accentColor: '#fde68a' });
    const lightButton = screen.getByRole('link', { name: 'Subscribe to updates' });
    expect(lightButton.style.color).toBe('rgb(17, 24, 39)');
  });

  it('ignores an invalid accent and keeps the default button', () => {
    renderHeader({ accentColor: 'red' });
    const button = screen.getByRole('link', { name: 'Subscribe to updates' });
    expect(button.getAttribute('style')).toBeNull();
  });

  it('hides the subscribe button without a target', () => {
    renderHeader({ subscribeHref: undefined });
    expect(screen.queryByRole('link', { name: 'Subscribe to updates' })).not.toBeInTheDocument();
  });
});
