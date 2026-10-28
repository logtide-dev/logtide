import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import AdminUsersTable from './AdminUsersTable.svelte';

const user = (over = {}) => ({
  id: 'u1',
  email: 'a@b.co',
  name: 'Ann',
  is_admin: false,
  disabled: false,
  created_at: '2026-01-01T00:00:00Z',
  last_login: null,
  orgCount: 3,
  ...over,
});

describe('AdminUsersTable', () => {
  it('links the email to the detail page and shows org count', () => {
    render(AdminUsersTable as never, { users: [user()] } as never);
    const link = screen.getAllByRole('link', { name: 'a@b.co' })[0];
    expect(link).toHaveAttribute('href', '/dashboard/admin/users/u1');
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows Never for no login and one state pill for disabled users', () => {
    render(AdminUsersTable as never, { users: [user({ disabled: true, is_admin: true })] } as never);
    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.queryByText('Active')).toBeNull();
  });
});
