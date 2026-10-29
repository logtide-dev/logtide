import type { SigmaRuleListItem } from '@logtide/shared';

function humanise(id: string): string {
  const text = id.replace(/[-_]+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Display name of where a rule came from. */
export function sourceLabel(
  rule: Pick<SigmaRuleListItem, 'source' | 'packId'>,
  packNames: Record<string, string> = {},
): string {
  if (rule.source === 'sigmahq') return 'SigmaHQ';
  if (rule.source === 'pack') {
    if (rule.packId && packNames[rule.packId]) return packNames[rule.packId];
    return rule.packId ? humanise(rule.packId) : 'Pack';
  }
  return 'Custom';
}
