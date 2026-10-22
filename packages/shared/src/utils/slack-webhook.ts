/**
 * Slack incoming webhook URL detection.
 *
 * Only classic incoming webhooks (/services/T../B../token) expect Block Kit
 * JSON. Workflow triggers (/triggers/...) take free-form JSON and are left
 * alone.
 */

const SLACK_PATH = /^\/services\/T[^/]+\/B[^/]+\/[^/]+$/;

export function isSlackWebhookTarget(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host !== 'hooks.slack.com' && host !== 'hooks.slack-gov.com') return false;
  return SLACK_PATH.test(url.pathname);
}

export function isSlackWebhookUrl(url: string): boolean {
  try {
    return isSlackWebhookTarget(new URL(url));
  } catch {
    return false;
  }
}
