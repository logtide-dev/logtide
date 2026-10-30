import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SessionTimeline from './SessionTimeline.svelte';

const crumb = {
  type: 'ui',
  category: 'click',
  message: 'clicked buy',
  timestamp: Date.parse('2026-01-01T10:00:00Z'),
};

function ev(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    time: '2026-01-01T10:00:01.000Z',
    service: 'web',
    level: 'info',
    message: `message ${id}`,
    ...extra,
  };
}

describe('SessionTimeline', () => {
  it('filters by level and category', async () => {
    render(SessionTimeline, {
      props: {
        projectId: 'p1',
        events: [
          ev('a', { level: 'error' }),
          ev('b', { level: 'info' }),
          ev('c', {
            level: 'info',
            metadata: { breadcrumbs: [crumb, { ...crumb, type: 'http', message: 'GET /x' }] },
          }),
        ],
      },
    });
    expect(screen.getAllByTestId('timeline-log')).toHaveLength(3);

    await fireEvent.change(screen.getByLabelText('Filter by level'), { target: { value: 'error' } });
    expect(screen.getAllByTestId('timeline-log')).toHaveLength(1);
    expect(screen.getByText('message a')).toBeInTheDocument();

    await fireEvent.change(screen.getByLabelText('Filter by level'), { target: { value: 'all' } });
    await fireEvent.change(screen.getByLabelText('Filter by type'), { target: { value: 'breadcrumbs' } });
    expect(screen.getAllByTestId('timeline-breadcrumb')).toHaveLength(2);
    await fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'http' } });
    expect(screen.getAllByTestId('timeline-breadcrumb')).toHaveLength(1);
    expect(screen.getByText('GET /x')).toBeInTheDocument();
  });

  it('breadcrumbs are deduplicated', () => {
    render(SessionTimeline, {
      props: {
        projectId: 'p1',
        events: [
          ev('a', { metadata: { breadcrumbs: [crumb] } }),
          ev('b', { metadata: { breadcrumbs: [crumb] } }),
        ],
      },
    });
    expect(screen.getAllByTestId('timeline-breadcrumb')).toHaveLength(1);
  });
});
