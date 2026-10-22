import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import EmptyDashboard from './EmptyDashboard.svelte';

describe('EmptyDashboard', () => {
  it('shows the shared connect snippets with the platform picker', () => {
    render(EmptyDashboard);
    expect(screen.getByRole('radiogroup', { name: 'Platform' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio').length).toBeGreaterThan(0);
  });

  it('no longer hand-builds the DSN snippet', () => {
    render(EmptyDashboard);
    expect(document.body.textContent).not.toContain('https://YOUR_API_KEY@');
    expect(document.body.textContent).toContain('YOUR_API_KEY');
  });

  it('keeps the welcome hero and quick actions', () => {
    render(EmptyDashboard);
    expect(screen.getByText('Welcome to LogTide!')).toBeInTheDocument();
    expect(screen.getByText('Create a project')).toBeInTheDocument();
  });
});
