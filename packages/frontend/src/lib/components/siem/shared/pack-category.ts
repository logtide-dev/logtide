import type { PackCategory } from '@logtide/shared';
import { levelTone, severityTone, stateTone } from '$lib/utils/severity';

/** Badge classes for a detection pack category, from the shared tone tables. */
export function packCategoryBadge(category: PackCategory | string): string {
  switch (category) {
    case 'security':
      return severityTone('high').badge;
    case 'database':
      return severityTone('critical').badge;
    case 'business':
      return stateTone('ok').badge;
    case 'reliability':
      return levelTone('info').badge;
    default:
      return stateTone('disabled').badge;
  }
}
