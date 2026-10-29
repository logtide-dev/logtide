import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import BreadcrumbTimeline from './BreadcrumbTimeline.svelte';
import { displayPreferences } from '$lib/stores/display-preferences';
import { levelTone } from '$lib/utils/severity';

const EVENT = '2026-10-21T10:42:13.123Z';
const at = (offsetMs: number) => Date.parse(EVENT) - offsetMs;

beforeEach(() => {
  displayPreferences.set({ hour12: false, timeZone: 'UTC' });
});

describe('BreadcrumbTimeline', () => {
  it('shows the absolute time with milliseconds in the title', () => {
    render(BreadcrumbTimeline, {
      props: { breadcrumbs: [{ type: 'http', message: 'GET /api', timestamp: at(0) }], eventTime: EVENT },
    });
    expect(screen.getByText('at event').getAttribute('title')).toContain('10:42:13.123');
  });

  it('follows the display time zone in the title', () => {
    displayPreferences.set({ hour12: false, timeZone: 'Asia/Tokyo' });
    render(BreadcrumbTimeline, {
      props: { breadcrumbs: [{ type: 'http', message: 'GET /api', timestamp: at(0) }], eventTime: EVENT },
    });
    expect(screen.getByText('at event').getAttribute('title')).toContain('19:42:13.123');
  });

  it('uses the error level tone for the accent bar', () => {
    const { container } = render(BreadcrumbTimeline, {
      props: {
        breadcrumbs: [
          { type: 'error', level: 'error', message: 'boom', timestamp: at(500) },
          { type: 'ui', message: 'click', timestamp: at(900) },
        ],
        eventTime: EVENT,
      },
    });
    const bars = container.querySelectorAll('[data-breadcrumb-accent]');
    expect(bars).toHaveLength(2);
    expect(bars[0].className).toContain(levelTone('error').dot);
    // no level: the info tone
    expect(bars[1].className).toContain(levelTone('info').dot);
    // the error icon uses the level module too
    expect(container.querySelector(`.${levelTone('error').text}`)).not.toBeNull();
  });

  it('keeps relative labels', () => {
    render(BreadcrumbTimeline, {
      props: {
        breadcrumbs: [
          { type: 'console', message: 'now', timestamp: at(0) },
          { type: 'console', message: 'earlier', timestamp: at(1500) },
          { type: 'console', message: 'later', timestamp: at(-2000) },
        ],
        eventTime: EVENT,
      },
    });
    expect(screen.getByText('at event')).toBeTruthy();
    expect(screen.getByText('1.5s before')).toBeTruthy();
    expect(screen.getByText('2.0s after')).toBeTruthy();
  });

  it('expands breadcrumb data', async () => {
    render(BreadcrumbTimeline, {
      props: {
        breadcrumbs: [{ type: 'http', message: 'GET /api', timestamp: at(0), data: { status: 200 } }],
        eventTime: EVENT,
      },
    });
    await fireEvent.click(screen.getByRole('button', { name: /GET \/api/ }));
    expect(screen.getByText(/"status": 200/)).toBeTruthy();
  });

  it('says when there are no breadcrumbs', () => {
    render(BreadcrumbTimeline, { props: { breadcrumbs: [], eventTime: EVENT } });
    expect(screen.getByText('No breadcrumbs recorded')).toBeTruthy();
  });
});
