/**
 * Exception tracking constants and derived types
 */

// Supported programming languages for exception parsing
export const EXCEPTION_LANGUAGES = [
  'nodejs',
  'python',
  'java',
  'go',
  'php',
  'kotlin',
  'csharp',
  'rust',
  'ruby',
  'unknown',
] as const;
export type ExceptionLanguage = (typeof EXCEPTION_LANGUAGES)[number];

// Error group statuses
export const ERROR_GROUP_STATUSES = ['open', 'resolved', 'ignored'] as const;
export type ErrorGroupStatus = (typeof ERROR_GROUP_STATUSES)[number];

// Error group list sort keys (always descending)
export const ERROR_GROUP_SORTS = ['last_seen', 'first_seen', 'events'] as const;
export type ErrorGroupSort = (typeof ERROR_GROUP_SORTS)[number];

// Bulk triage actions
export const ERROR_GROUP_BULK_ACTIONS = ['resolve', 'ignore', 'assign', 'reopen'] as const;
export type ErrorGroupBulkAction = (typeof ERROR_GROUP_BULK_ACTIONS)[number];

// Event paging directions on the error group detail page
export const ERROR_GROUP_EVENT_DIRECTIONS = ['older', 'newer'] as const;
export type ErrorGroupEventDirection = (typeof ERROR_GROUP_EVENT_DIRECTIONS)[number];
