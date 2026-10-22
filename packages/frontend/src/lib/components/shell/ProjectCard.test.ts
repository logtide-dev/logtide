import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { Project } from '@logtide/shared';
import ProjectCard from './ProjectCard.svelte';

const project = {
  id: 'p-1',
  organizationId: 'org-1',
  name: 'Checkout API',
  description: 'Payments service',
  slug: 'checkout-api',
  statusPageVisibility: 'disabled',
  createdAt: new Date('2026-09-01T10:00:00Z'),
  updatedAt: new Date('2026-09-01T10:00:00Z'),
} as unknown as Project;

const ago = { kind: 'ago' as const, text: 'Last event 5 minutes ago' };
const waiting = { kind: 'waiting' as const, text: 'Waiting for data' };
const receiving = { kind: 'receiving' as const, text: 'Receiving data' };

describe('ProjectCard', () => {
  it('renders name, description and the last event text', () => {
    render(ProjectCard, { props: { project, status: ago } });
    expect(screen.getByText('Checkout API')).toBeInTheDocument();
    expect(screen.getByText('Payments service')).toBeInTheDocument();
    expect(screen.getByTestId('last-event')).toHaveTextContent('Last event 5 minutes ago');
  });

  it('links to the overview and to the pre-scoped logs', () => {
    render(ProjectCard, { props: { project, status: ago } });
    expect(screen.getByRole('link', { name: 'View project' })).toHaveAttribute(
      'href',
      '/dashboard/projects/p-1/overview',
    );
    expect(screen.getByRole('link', { name: 'Logs' })).toHaveAttribute('href', '/dashboard/logs?project=p-1');
  });

  it('shows a primary Connect link only while waiting for data', () => {
    const { unmount } = render(ProjectCard, { props: { project, status: waiting } });
    expect(screen.getByRole('link', { name: 'Connect' })).toHaveAttribute(
      'href',
      '/dashboard/projects/p-1/settings#connect',
    );
    unmount();

    const r1 = render(ProjectCard, { props: { project, status: ago } });
    expect(screen.queryByRole('link', { name: 'Connect' })).toBeNull();
    r1.unmount();

    render(ProjectCard, { props: { project, status: receiving } });
    expect(screen.queryByRole('link', { name: 'Connect' })).toBeNull();
  });

  it('has no delete or trash control and no destructive styling', () => {
    const { container } = render(ProjectCard, { props: { project, status: waiting } });
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.innerHTML).not.toMatch(/destructive|trash|delete/i);
  });
});
