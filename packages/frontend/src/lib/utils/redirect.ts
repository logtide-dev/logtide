/**
 * Guard against open-redirect via a user-supplied `redirect` query parameter.
 *
 * A value is only safe to navigate to if it is anchored at the site root and
 * cannot be coerced into a cross-origin destination. We require it to start with
 * a single "/" and reject protocol-relative forms ("//evil.com") including the
 * backslash variant ("/\\evil.com") that some browsers normalize to "//".
 */
export function isSafeInternalPath(path: string | null | undefined): path is string {
  if (!path) return false;
  if (path[0] !== '/') return false; // must be relative to the site root
  // Block "//evil.com" and "/\evil.com" (protocol-relative / browser-normalized).
  if (path[1] === '/' || path[1] === '\\') return false;
  return true;
}

/**
 * Return `path` if it is a safe in-app destination, otherwise `fallback`.
 */
export function safeRedirect(
  path: string | null | undefined,
  fallback = '/dashboard',
): string {
  return isSafeInternalPath(path) ? path : fallback;
}
