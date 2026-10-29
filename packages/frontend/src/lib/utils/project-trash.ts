/**
 * Shared copy for moving a project to the trash. Mirrors the backend:
 * DELETE /projects/:id is a soft delete, ingestion stops immediately, and the
 * worker hard-deletes the row (cascading to API keys and alert rules) after
 * PROJECT_HARD_DELETE_GRACE_DAYS (backend/src/worker.ts).
 */
export const PROJECT_TRASH_RETENTION_DAYS = 30;

export function PROJECT_TRASH_DIALOG_TEXT(name: string): string {
  return `${name} stops accepting data and moves to the trash. You can restore it within ${PROJECT_TRASH_RETENTION_DAYS} days. After that its logs, traces, metrics, API keys and alert rules are permanently deleted.`;
}

export const PROJECT_TRASH_TOAST = `Project moved to trash. Restore it from the projects list within ${PROJECT_TRASH_RETENTION_DAYS} days.`;
