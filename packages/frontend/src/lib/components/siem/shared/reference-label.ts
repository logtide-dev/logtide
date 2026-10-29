const MITRE_HOST = 'attack.mitre.org';

/** Link text for a rule reference URL. */
export function referenceLabel(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'Reference';
  }
  if (!host) return 'Reference';
  if (host === MITRE_HOST || host.endsWith(`.${MITRE_HOST}`)) return 'MITRE reference';
  return host.replace(/^www\./, '');
}
