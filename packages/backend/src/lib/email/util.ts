import { config } from '../../config/index.js';

/**
 * Get the frontend URL from config, with a sensible fallback.
 * In production, FRONTEND_URL should always be set.
 */
export function getFrontendUrl(): string {
  if (config.FRONTEND_URL) {
    return config.FRONTEND_URL.replace(/\/$/, ''); // Remove trailing slash
  }

  // Log warning in production if FRONTEND_URL is not set
  if (config.NODE_ENV === 'production') {
    console.warn('[Email] FRONTEND_URL not set in production - email links will be broken');
  }

  return 'http://localhost:5173';
}

/**
 * Format a date for display in emails
 */
export function formatEmailDate(date: Date = new Date()): string {
  return date.toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * Escape HTML to prevent XSS in email content
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}
