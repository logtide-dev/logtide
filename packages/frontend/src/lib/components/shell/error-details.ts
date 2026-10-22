import { get } from 'svelte/store';
import { authStore } from '$lib/stores/auth';

export interface ErrorDetailsContext {
  /** Current location. Only the path is kept, query string and hash are dropped. */
  pathname: string;
  version: string;
  now?: Date;
}

const REDACTED = '[redacted]';

function stripQuery(path: string): string {
  const cut = path.search(/[?#]/);
  return cut === -1 ? path : path.slice(0, cut);
}

/** Remove the auth token, bearer values and URL query strings from free text. */
function sanitize(text: string): string {
  let out = text;
  const token = get(authStore).token;
  if (token && token.length >= 4) out = out.split(token).join(REDACTED);
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`);
  // Shared links carry filters in the query string; stack frames carry full URLs.
  out = out.replace(/(https?:\/\/[^\s?#)'"]+)[?#][^\s)'"]*/g, '$1');
  return out;
}

function describe(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack ?? null };
  }
  if (typeof error === 'string') return { message: error, stack: null };
  if (error === undefined || error === null) return { message: 'Unknown error', stack: null };
  try {
    return { message: JSON.stringify(error), stack: null };
  } catch {
    return { message: String(error), stack: null };
  }
}

/**
 * Plain-text report the user can paste into a bug report. It never contains
 * the auth token or the query string of the current URL.
 */
export function buildErrorDetails(error: unknown, ctx: ErrorDetailsContext): string {
  const { message, stack } = describe(error);
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  const lines = [
    `Message: ${sanitize(message)}`,
    `Path: ${stripQuery(ctx.pathname)}`,
    `Version: ${ctx.version}`,
    `Time: ${(ctx.now ?? new Date()).toISOString()}`,
    `User agent: ${userAgent}`,
  ];
  if (stack) lines.push('', 'Stack:', sanitize(stack));
  return lines.join('\n');
}
