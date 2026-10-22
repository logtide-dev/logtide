import type { PackCategory } from '@logtide/shared';

export interface PackDestinationCopy {
  where: string;
  createsIncidents: boolean;
  summary: string;
}

/** Where the matches of a detection pack show up, by category. */
export function packDestinationCopy(category: PackCategory): PackDestinationCopy {
  if (category === 'security') {
    return {
      where: 'Security overview',
      createsIncidents: true,
      summary: 'Matches appear in the Security overview and group into incidents.',
    };
  }
  return {
    where: 'Alerts history',
    createsIncidents: false,
    summary: 'Matches appear in Alerts history and do not create incidents.',
  };
}
