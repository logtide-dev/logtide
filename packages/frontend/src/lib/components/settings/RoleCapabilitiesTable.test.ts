import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import RoleCapabilitiesTable from './RoleCapabilitiesTable.svelte';
import { ROLE_CAPABILITIES } from './roles';

describe('RoleCapabilitiesTable', () => {
  it('renders one row per capability', () => {
    render(RoleCapabilitiesTable);
    expect(screen.getAllByTestId('role-capability-row')).toHaveLength(ROLE_CAPABILITIES.length);
  });

  it('renders role column headers', () => {
    render(RoleCapabilitiesTable);
    for (const name of ['Owner', 'Admin', 'Member']) {
      expect(screen.getByRole('columnheader', { name })).toBeTruthy();
    }
  });

  it('marks allowed and not allowed per role', () => {
    render(RoleCapabilitiesTable);
    const rows = screen.getAllByTestId('role-capability-row');
    ROLE_CAPABILITIES.forEach((cap, i) => {
      const allowed = within(rows[i]).queryAllByLabelText('Allowed');
      const denied = within(rows[i]).queryAllByLabelText('Not allowed');
      expect(allowed).toHaveLength(cap.roles.length);
      expect(denied).toHaveLength(3 - cap.roles.length);
    });
  });
});
