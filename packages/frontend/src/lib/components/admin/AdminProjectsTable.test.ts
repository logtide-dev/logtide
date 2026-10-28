import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import AdminProjectsTable from './AdminProjectsTable.svelte';

const project = (over = {}) => ({
  id: 'p1',
  name: 'Api',
  description: null,
  organization_id: 'o1',
  organizationId: 'o1',
  organization_name: 'Acme',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  logsCount: 1200,
  logs30d: 1200,
  apiKeysCount: 2,
  alertRulesCount: 4,
  alertRulesEnabled: 3,
  alertRulesTotal: 4,
  ...over,
});

describe('AdminProjectsTable', () => {
  it('links project and organization, formats logs and rules', () => {
    render(AdminProjectsTable as never, { projects: [project()], onDelete: vi.fn() });
    expect(screen.getAllByRole('link', { name: 'Api' })[0]).toHaveAttribute('href', '/dashboard/admin/projects/p1');
    expect(screen.getAllByRole('link', { name: 'Acme' })[0]).toHaveAttribute('href', '/dashboard/admin/organizations/o1');
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByText('3 / 4')).toBeInTheDocument();
  });

  it('calls onDelete with a labelled button and hides it for deleted rows', async () => {
    const onDelete = vi.fn();
    const p = project();
    const { rerender } = render(AdminProjectsTable as never, { projects: [p], onDelete });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith(p);
    await rerender({ projects: [project({ deletedAt: '2026-02-01T00:00:00Z' })], onDelete });
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.getByText('Deleted')).toBeInTheDocument();
  });
});
