import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Footer from './Footer.svelte';
import { APP_VERSION } from '$lib/app-version';

describe('Footer', () => {
  it('renders the version from APP_VERSION', () => {
    render(Footer);
    expect(screen.getByText(APP_VERSION)).toBeInTheDocument();
  });

  it('has Documentation and GitHub links that open safely', () => {
    render(Footer);
    const docs = screen.getByRole('link', { name: /Documentation|Docs/ });
    expect(docs).toHaveAttribute('href', 'https://logtide.dev/docs');
    expect(docs).toHaveAttribute('rel', 'noopener noreferrer');
    const github = screen.getByRole('link', { name: 'View on GitHub' });
    expect(github).toHaveAttribute('rel', 'noopener noreferrer');
    expect(github).toHaveAttribute('aria-label', 'View on GitHub');
  });

  it('shows the current year in the copyright', () => {
    render(Footer);
    expect(screen.getByText(`© ${new Date().getFullYear()} LogTide`)).toBeInTheDocument();
  });
});
