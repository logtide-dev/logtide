import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
import type { SigmaRuleListItem } from '@logtide/shared';
import SigmaRulesTable from './SigmaRulesTable.svelte';

function rule(over: Partial<SigmaRuleListItem> = {}): SigmaRuleListItem {
  return {
    id: 'r1',
    organizationId: 'org-1',
    projectId: null,
    sigmaId: 'abc',
    title: 'Suspicious login',
    description: 'Detects many failed logins',
    author: null,
    date: null,
    level: 'high',
    status: 'stable',
    logsource: {},
    detection: {},
    emailRecipients: null,
    webhookUrl: null,
    alertRuleId: null,
    conversionStatus: 'success',
    conversionNotes: null,
    enabled: true,
    tags: null,
    mitreTactics: ['initial_access', 'execution', 'impact'],
    mitreTechniques: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    source: 'custom',
    packId: null,
    hits7d: 1234,
    lastFiredAt: '2026-10-20T10:00:00.000Z',
    exceptionCount: 0,
    ...over,
  };
}

const base = { loading: false, togglingId: null, onToggle: vi.fn() };

describe('SigmaRulesTable', () => {
  it('renders one row per rule with hits formatted en-US', () => {
    render(SigmaRulesTable, {
      ...base,
      rules: [rule(), rule({ id: 'r2', title: 'Port scan', hits7d: 0 })],
    });
    expect(screen.getByRole('link', { name: 'Suspicious login' })).toHaveAttribute(
      'href',
      '/dashboard/security/rules/r1',
    );
    expect(screen.getByRole('link', { name: 'Port scan' })).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    // header row + 2 data rows
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('shows Never when lastFiredAt is null', () => {
    render(SigmaRulesTable, { ...base, rules: [rule({ lastFiredAt: null })] });
    expect(screen.getByText('Never')).toBeInTheDocument();
  });

  it('shows two tactics and a +N chip', () => {
    render(SigmaRulesTable, { ...base, rules: [rule()] });
    expect(screen.getByText('Initial Access')).toBeInTheDocument();
    expect(screen.getByText('Execution')).toBeInTheDocument();
    expect(screen.queryByText('Impact')).toBeNull();
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('labels the source column', () => {
    render(SigmaRulesTable, {
      ...base,
      rules: [
        rule({ id: 'a', title: 'A', source: 'sigmahq' }),
        rule({ id: 'b', title: 'B', source: 'pack', packId: 'startup-reliability' }),
      ],
      packNames: {},
    });
    expect(screen.getByText('SigmaHQ')).toBeInTheDocument();
    expect(screen.getByText('Startup reliability')).toBeInTheDocument();
  });

  it('toggle calls onToggle with the new value', async () => {
    const onToggle = vi.fn();
    const r = rule();
    render(SigmaRulesTable, { ...base, onToggle, rules: [r] });
    await fireEvent.click(screen.getByRole('switch', { name: 'Enable Suspicious login' }));
    expect(onToggle).toHaveBeenCalledWith(r, false);
  });

  it('switch and actions button have aria-labels containing the rule title', () => {
    render(SigmaRulesTable, { ...base, rules: [rule()] });
    expect(screen.getByRole('switch', { name: 'Enable Suspicious login' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions for Suspicious login' })).toBeInTheDocument();
  });

  it('select all selects visible rows', async () => {
    render(SigmaRulesTable, { ...base, rules: [rule(), rule({ id: 'r2', title: 'Port scan' })] });
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    const rows = screen.getAllByRole('checkbox', { name: 'Select row' });
    expect(rows).toHaveLength(2);
    for (const cb of rows) expect(cb).toHaveAttribute('data-state', 'checked');
  });

  it('clicking the Hits header sorts', async () => {
    render(SigmaRulesTable, { ...base, rules: [rule()] });
    const header = screen.getByRole('columnheader', { name: /Hits \(7d\)/ });
    expect(header).toHaveAttribute('aria-sort', 'none');
    await fireEvent.click(within(header).getByRole('button'));
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    await fireEvent.click(within(header).getByRole('button'));
    expect(header).toHaveAttribute('aria-sort', 'descending');
  });
});
