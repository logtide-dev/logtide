import { readable, type Readable } from 'svelte/store';

/** Same cut-off as Tailwind `md`: below it the layout is the phone one. */
export const MOBILE_QUERY = '(max-width: 767.98px)';

/** A store that follows a CSS media query; false on the server and when matchMedia is missing. */
export function mediaQuery(query: string): Readable<boolean> {
  return readable(false, (set) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => set(list.matches);
    update();
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', update);
      return () => list.removeEventListener('change', update);
    }
    if (typeof list.addListener === 'function') {
      list.addListener(update);
      return () => list.removeListener(update);
    }
  });
}

/** Very narrow phones (below 360 px): rows give their meta line room to wrap. */
export const isNarrow = mediaQuery('(max-width: 359.98px)');

/** True below the md breakpoint. */
export const isMobile = mediaQuery(MOBILE_QUERY);
