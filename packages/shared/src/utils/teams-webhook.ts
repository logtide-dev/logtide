/**
 * Microsoft Teams webhook URL detection (Office 365 connectors and Power
 * Automate Workflows). Hosts match by exact name or dot-prefixed suffix only.
 */

export function isTeamsWebhookTarget(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  if (host.endsWith('.webhook.office.com')) return path.startsWith('/webhookb2/');
  if (host === 'outlook.office.com' || host === 'outlook.office365.com') {
    return path.startsWith('/webhook/');
  }
  if (host.endsWith('.logic.azure.com')) return path.startsWith('/workflows/');
  if (host === 'api.powerplatform.com' || host.endsWith('.api.powerplatform.com')) {
    return path.startsWith('/powerautomate/automations/direct/workflows/');
  }
  return false;
}

export function isTeamsWebhookUrl(url: string): boolean {
  try {
    return isTeamsWebhookTarget(new URL(url));
  } catch {
    return false;
  }
}
