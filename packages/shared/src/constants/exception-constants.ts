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
