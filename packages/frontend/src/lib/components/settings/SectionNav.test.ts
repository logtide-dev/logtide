import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import SectionNav from './SectionNav.svelte';

const Icon = (() => {}) as unknown;

describe('SectionNav mobile pill row', () => {
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('scrolls the active pill into view', async () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    const groups = [
      {
        label: 'g',
        items: [
          { label: 'Profile', href: '/a', icon: Icon },
          { label: 'General', href: '/b', icon: Icon },
        ],
      },
    ];
    render(SectionNav, { groups, isActive: (h: string) => h === '/b' });
    await Promise.resolve();
    expect(spy).toHaveBeenCalled();
    const target = spy.mock.contexts[0] as HTMLElement;
    expect(target.textContent).toContain('General');
    expect(target.closest('nav')!.getAttribute('aria-label')).toContain('compact');
  });
});
