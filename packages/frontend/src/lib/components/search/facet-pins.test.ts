import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { createFacetPinsStore } from './facet-pins';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('facet pins store', () => {
  it('pins persist per project key and cap at 8', () => {
    const a = createFacetPinsStore('p1');
    a.pin('user.id');
    a.pin('env');
    a.pin('user.id');
    expect(get(a)).toEqual(['user.id', 'env']);
    expect(JSON.parse(localStorage.getItem('logtide:facet-pins:p1') ?? 'null')).toEqual(['user.id', 'env']);

    expect(get(createFacetPinsStore('p1'))).toEqual(['user.id', 'env']);
    expect(get(createFacetPinsStore('p2'))).toEqual([]);

    for (let i = 0; i < 10; i++) a.pin(`k${i}`);
    expect(get(a)).toHaveLength(8);
    expect(get(a).slice(0, 2)).toEqual(['user.id', 'env']);
  });

  it('unpins', () => {
    const s = createFacetPinsStore('p1');
    s.pin('a');
    s.pin('b');
    s.unpin('a');
    expect(get(s)).toEqual(['b']);
    expect(get(createFacetPinsStore('p1'))).toEqual(['b']);
  });

  it('ignores garbage in storage', () => {
    localStorage.setItem('logtide:facet-pins:p1', '{not json');
    expect(get(createFacetPinsStore('p1'))).toEqual([]);
    localStorage.setItem('logtide:facet-pins:p2', JSON.stringify(['a', 3, 'a', null, 'b']));
    expect(get(createFacetPinsStore('p2'))).toEqual(['a', 'b']);
  });

  it('pins survive a throwing localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const s = createFacetPinsStore('p1');
    expect(get(s)).toEqual([]);
    s.pin('user.id');
    expect(get(s)).toEqual(['user.id']);
  });

  it('set and update keep the list valid', () => {
    const s = createFacetPinsStore('p1');
    s.set(['a', 'a', 'b']);
    expect(get(s)).toEqual(['a', 'b']);
    s.update((pins) => [...pins, 'c']);
    expect(get(s)).toEqual(['a', 'b', 'c']);
  });
});
