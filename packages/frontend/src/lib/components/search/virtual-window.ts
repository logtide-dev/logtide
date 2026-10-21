// DOM windowing math for the results table: only the rows around the
// viewport are rendered, spacer rows stand in for the rest. Rows have a fixed
// height per density, so every position is a multiplication.

export const ROW_HEIGHT = { comfortable: 36, compact: 28 } as const;

const DEFAULT_OVERSCAN = 10;
/** Used before the scroll container has been measured (jsdom, first paint). */
const FALLBACK_VIEWPORT = 600;

export interface VirtualWindow {
  /** First rendered index (inclusive). */
  start: number;
  /** Last rendered index (exclusive). */
  end: number;
  /** Height of the spacer above the rendered rows. */
  padTop: number;
  /** Height of the spacer below the rendered rows. */
  padBottom: number;
}

export function computeWindow(i: {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  count: number;
  overscan?: number;
}): VirtualWindow {
  const { rowHeight, count } = i;
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const overscan = i.overscan ?? DEFAULT_OVERSCAN;
  const viewport = i.viewportHeight > 0 ? i.viewportHeight : FALLBACK_VIEWPORT;
  const maxScroll = Math.max(0, count * rowHeight - viewport);
  const scrollTop = Math.min(Math.max(0, i.scrollTop), maxScroll);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan);
  return { start, end, padTop: start * rowHeight, padBottom: (count - end) * rowHeight };
}

/** Scroll position that puts row `index` in the middle of the viewport. */
export function centerScrollTop(index: number, rowHeight: number, viewportHeight: number): number {
  return Math.max(0, index * rowHeight - (viewportHeight - rowHeight) / 2);
}

/** Smallest scroll change that makes row `index` fully visible. */
export function revealScrollTop(index: number, rowHeight: number, viewportHeight: number, scrollTop: number): number {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportHeight) return Math.max(0, bottom - viewportHeight);
  return scrollTop;
}

export function isNearBottom(i: {
  scrollTop: number;
  viewportHeight: number;
  contentHeight: number;
  threshold: number;
}): boolean {
  return i.scrollTop + i.viewportHeight >= i.contentHeight - i.threshold;
}
