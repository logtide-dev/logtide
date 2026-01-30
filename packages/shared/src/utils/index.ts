import { LOG_LEVELS, type LogLevel } from '../constants/log-constants.js';

export function formatTimestamp(date: Date): string {
  return date.toISOString();
}

export function isValidLogLevel(level: string): level is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(level);
}

// Re-export utility modules
export * from './datetime.js';
export * from './mitre.js';
export * from './severity.js';
