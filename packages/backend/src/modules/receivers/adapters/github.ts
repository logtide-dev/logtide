import type { LogInput, LogLevel } from '@logtide/shared';
import type { ReceiverAdapter } from './types.js';

function conclusionLevel(conclusion: string | null): LogLevel {
  switch (conclusion) {
    case 'success':
      return 'info';
    case 'cancelled':
    case 'skipped':
    case 'neutral':
      return 'warn';
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
    case 'action_required':
      return 'error';
    default:
      return 'info';
  }
}

function isoOrNow(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/**
 * GitHub webhook adapter (#155). Detects events by payload shape rather than
 * the X-GitHub-Event header so replayed/stored payloads normalize identically.
 * Supported: workflow_run (completed), deployment_status. Ping and everything
 * else is skipped.
 */
export const githubAdapter: ReceiverAdapter = (payload, receiver) => {
  if ('zen' in payload && 'hook_id' in payload) {
    return { kind: 'skipped', reason: 'github ping event' };
  }

  const repoName = asRecord(payload.repository)?.full_name;
  const service = (typeof repoName === 'string' ? repoName : 'github').slice(0, 100);
  const senderLogin = asRecord(payload.sender)?.login;
  const actor = typeof senderLogin === 'string' ? senderLogin : undefined;
  const action = typeof payload.action === 'string' ? payload.action : undefined;

  const run = asRecord(payload.workflow_run);
  if (run) {
    if (action !== 'completed') {
      return { kind: 'skipped', reason: `workflow_run action "${action ?? 'unknown'}" ignored` };
    }
    const conclusion = typeof run.conclusion === 'string' ? run.conclusion : null;
    const workflowName = typeof run.name === 'string' ? run.name : 'workflow';
    const log: LogInput = {
      time: isoOrNow(run.updated_at),
      service,
      level: conclusionLevel(conclusion),
      message: `Workflow ${workflowName} completed: ${conclusion ?? 'unknown'}`,
      metadata: {
        receiver: { id: receiver.id, name: receiver.name, adapter: 'github' },
        event: 'workflow_run',
        action,
        repository: service,
        workflow: workflowName,
        conclusion,
        run_id: run.id,
        run_url: run.html_url,
        branch: run.head_branch,
        actor,
      },
    };
    return { kind: 'logs', logs: [log] };
  }

  const status = asRecord(payload.deployment_status);
  if (status) {
    const deployment = asRecord(payload.deployment);
    const state = typeof status.state === 'string' ? status.state : 'unknown';
    const environment =
      typeof status.environment === 'string'
        ? status.environment
        : typeof deployment?.environment === 'string'
          ? deployment.environment
          : 'unknown';
    const level: LogLevel =
      state === 'success' ? 'info' : state === 'failure' || state === 'error' ? 'error' : 'info';
    const log: LogInput = {
      time: isoOrNow(status.updated_at),
      service,
      level,
      message: `Deployment to ${environment}: ${state}`,
      metadata: {
        receiver: { id: receiver.id, name: receiver.name, adapter: 'github' },
        event: 'deployment_status',
        action,
        repository: service,
        environment,
        state,
        deployment_url: status.target_url,
        actor,
      },
    };
    return { kind: 'logs', logs: [log] };
  }

  return { kind: 'skipped', reason: 'unsupported github event' };
};
