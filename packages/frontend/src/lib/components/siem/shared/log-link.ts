const WINDOW_MS = 5 * 60 * 1000;

/**
 * Link to the Logs page focused on one log: the log id, its project and a
 * five minute window either side of the event time.
 */
export function logLink(input: {
  logId: string;
  projectId?: string | null;
  time: string | Date;
}): string {
  const params = new URLSearchParams();
  params.set('logId', input.logId);
  if (input.projectId) params.set('project', input.projectId);
  const at = input.time instanceof Date ? input.time : new Date(input.time);
  if (!isNaN(at.getTime())) {
    params.set('from', new Date(at.getTime() - WINDOW_MS).toISOString());
    params.set('to', new Date(at.getTime() + WINDOW_MS).toISOString());
  }
  return `/dashboard/logs?${params.toString()}`;
}
