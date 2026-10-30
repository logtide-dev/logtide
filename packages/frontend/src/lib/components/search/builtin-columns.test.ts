import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  BUILTIN_COLUMNS,
  BUILTIN_COLUMN_LABELS,
  DEFAULT_BUILTIN_LAYOUT,
  createBuiltinColumnsStore,
  moveColumn,
  normalizeLayout,
  toggleColumn,
  visibleColumns,
} from './builtin-columns';

const D = DEFAULT_BUILTIN_LAYOUT;

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('builtin column layout', () => {
  it('lists the six built-in columns with sentence case labels', () => {
    expect([...BUILTIN_COLUMNS]).toEqual(['time', 'project', 'service', 'host', 'level', 'message']);
    expect(BUILTIN_COLUMNS.map((c) => BUILTIN_COLUMN_LABELS[c])).toEqual([
      'Time',
      'Project',
      'Service',
      'Host',
      'Level',
      'Message',
    ]);
    expect(D).toEqual({ order: [...BUILTIN_COLUMNS], hidden: [] });
  });

  it('normalizes stored layouts', () => {
    expect(normalizeLayout({ order: ['level', 'bogus', 'time'], hidden: ['message', 'host'] })).toEqual({
      order: ['level', 'time', 'project', 'service', 'host', 'message'],
      hidden: ['host'],
    });
  });

  it('falls back to the default for garbage and drops duplicates', () => {
    expect(normalizeLayout(null)).toEqual(D);
    expect(normalizeLayout('x')).toEqual(D);
    expect(normalizeLayout({ order: 'time', hidden: 7 })).toEqual(D);
    expect(normalizeLayout({ order: ['host', 'host', 1], hidden: ['host', 'host'] })).toEqual({
      order: ['host', 'time', 'project', 'service', 'level', 'message'],
      hidden: ['host'],
    });
  });

  it('never hides the message column', () => {
    expect(toggleColumn(D, 'message')).toEqual(D);
  });

  it('toggles a column on and off', () => {
    const hidden = toggleColumn(D, 'host');
    expect(hidden.hidden).toEqual(['host']);
    expect(visibleColumns(hidden)).toEqual(['time', 'project', 'service', 'level', 'message']);
    expect(toggleColumn(hidden, 'host')).toEqual(D);
  });

  it('moves a column and clamps at the edges', () => {
    expect(moveColumn(D, 'time', -1)).toEqual(D);
    expect(moveColumn(D, 'time', 1).order[1]).toBe('time');
    expect(moveColumn(D, 'message', 1)).toEqual(D);
    expect(moveColumn(D, 'message', -1).order).toEqual(['time', 'project', 'service', 'host', 'message', 'level']);
  });

  it('keeps the visible order in step with the layout order', () => {
    const layout = { order: moveColumn(D, 'level', -1).order, hidden: ['time' as const] };
    expect(visibleColumns(layout)).toEqual(['project', 'service', 'level', 'host', 'message']);
  });
});

describe('createBuiltinColumnsStore', () => {
  it('persists per project key and tolerates storage errors', () => {
    const p1 = createBuiltinColumnsStore('p1');
    expect(get(p1)).toEqual(D);
    const moved = moveColumn(D, 'level', -1);
    p1.set(moved);
    expect(JSON.parse(localStorage.getItem('logtide:builtin-columns:p1') ?? 'null')).toEqual(moved);

    expect(get(createBuiltinColumnsStore('p2'))).toEqual(D);
    expect(get(createBuiltinColumnsStore('p1'))).toEqual(moved);

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const hidden = toggleColumn(moved, 'host');
    expect(() => p1.set(hidden)).not.toThrow();
    expect(get(p1)).toEqual(hidden);
    expect(() => p1.update((l) => toggleColumn(l, 'time'))).not.toThrow();
    expect(get(p1).hidden).toEqual(['host', 'time']);
  });

  it('reads the default when storage is unreadable or corrupt', () => {
    localStorage.setItem('logtide:builtin-columns:p3', '{not json');
    expect(get(createBuiltinColumnsStore('p3'))).toEqual(D);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(get(createBuiltinColumnsStore('p1'))).toEqual(D);
  });

  it('normalizes what it reads', () => {
    localStorage.setItem('logtide:builtin-columns:p4', JSON.stringify({ order: ['message'], hidden: ['message'] }));
    expect(get(createBuiltinColumnsStore('p4'))).toEqual({
      order: ['message', 'time', 'project', 'service', 'host', 'level'],
      hidden: [],
    });
  });
});
