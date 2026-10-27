import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ProjectHealthPill, { describeHealth } from './ProjectHealthPill.svelte';

const issue = (severity: 'critical' | 'warning', muted = false) => ({
  checkKey: 'silent' as const,
  severity,
  muted,
});

describe('describeHealth', () => {
  it('healthy with no issues', () => {
    expect(describeHealth({ status: 'healthy', openIssues: [] })).toEqual({ kind: 'healthy', text: 'Healthy' });
  });

  it('counts warnings and pluralizes', () => {
    expect(describeHealth({ status: 'warning', openIssues: [issue('warning')] }).text).toBe('1 warning');
    expect(describeHealth({ status: 'warning', openIssues: [issue('warning'), issue('warning')] }).text).toBe(
      '2 warnings',
    );
  });

  it('critical wins over warnings', () => {
    const m = describeHealth({ status: 'critical', openIssues: [issue('warning'), issue('critical')] });
    expect(m).toEqual({ kind: 'critical', text: '1 critical' });
  });

  it('excludes muted issues from the count', () => {
    const m = describeHealth({ status: 'healthy', openIssues: [issue('critical', true)] });
    expect(m.kind).toBe('healthy');
  });

  it('no data yet', () => {
    expect(describeHealth({ status: 'no_data', openIssues: [] }).text).toBe('No data yet');
  });
});

describe('ProjectHealthPill', () => {
  it('renders the text and kind', () => {
    render(ProjectHealthPill, { entry: { status: 'critical', openIssues: [issue('critical')] } });
    const pill = screen.getByTestId('health-pill');
    expect(pill).toHaveTextContent('1 critical');
    expect(pill.dataset.kind).toBe('critical');
  });

  it('renders a dash without an entry', () => {
    render(ProjectHealthPill, { entry: undefined });
    expect(screen.getByTestId('health-pill-empty')).toHaveTextContent('-');
  });
});
