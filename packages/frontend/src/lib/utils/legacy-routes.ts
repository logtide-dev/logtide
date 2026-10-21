/**
 * Permanent redirect for a moved route. `targetPath` must be a fixed constant
 * (plus encoded params) owned by the caller, never user input, so the location
 * can only ever be a same-origin path. The query string is kept verbatim.
 */
export function legacyRedirect(url: URL, targetPath: string): Response {
  return new Response(null, {
    status: 308,
    headers: { location: targetPath + url.search },
  });
}
