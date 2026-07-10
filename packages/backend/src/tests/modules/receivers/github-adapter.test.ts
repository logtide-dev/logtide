import { describe, it, expect } from 'vitest';
import { githubAdapter } from '../../../modules/receivers/adapters/github.js';
import type { AdapterReceiverInfo } from '../../../modules/receivers/adapters/types.js';

const receiver: AdapterReceiverInfo = {
  id: 'r-1',
  name: 'gh',
  adapterType: 'github',
  fieldMapping: null,
};

describe('githubAdapter', () => {
  it('skips ping events', () => {
    const result = githubAdapter({ zen: 'Keep it simple.', hook_id: 1 }, receiver);
    expect(result.kind).toBe('skipped');
  });

  it('maps a failed workflow_run to an error log', () => {
    const result = githubAdapter(
      {
        action: 'completed',
        workflow_run: {
          id: 42,
          name: 'CI',
          conclusion: 'failure',
          html_url: 'https://github.com/acme/app/actions/runs/42',
          head_branch: 'main',
          updated_at: '2026-07-01T10:00:00Z',
        },
        repository: { full_name: 'acme/app' },
        sender: { login: 'octocat' },
      },
      receiver
    );
    if (result.kind !== 'logs') throw new Error('expected logs');
    const log = result.logs[0];
    expect(log.level).toBe('error');
    expect(log.service).toBe('acme/app');
    expect(log.message).toBe('Workflow CI completed: failure');
    const meta = log.metadata as any;
    expect(meta.event).toBe('workflow_run');
    expect(meta.run_id).toBe(42);
    expect(meta.branch).toBe('main');
    expect(meta.actor).toBe('octocat');
  });

  it('maps a successful workflow_run to info and cancelled to warn', () => {
    const base = {
      action: 'completed',
      repository: { full_name: 'acme/app' },
    };
    const ok = githubAdapter(
      { ...base, workflow_run: { name: 'CI', conclusion: 'success', updated_at: '2026-07-01T10:00:00Z' } },
      receiver
    );
    const cancelled = githubAdapter(
      { ...base, workflow_run: { name: 'CI', conclusion: 'cancelled', updated_at: '2026-07-01T10:00:00Z' } },
      receiver
    );
    if (ok.kind !== 'logs' || cancelled.kind !== 'logs') throw new Error('expected logs');
    expect(ok.logs[0].level).toBe('info');
    expect(cancelled.logs[0].level).toBe('warn');
  });

  it('skips non-completed workflow_run actions', () => {
    const result = githubAdapter(
      { action: 'requested', workflow_run: { name: 'CI' }, repository: { full_name: 'acme/app' } },
      receiver
    );
    expect(result.kind).toBe('skipped');
  });

  it('maps deployment_status events', () => {
    const result = githubAdapter(
      {
        action: 'created',
        deployment_status: {
          state: 'failure',
          environment: 'production',
          updated_at: '2026-07-01T10:00:00Z',
        },
        deployment: { environment: 'production' },
        repository: { full_name: 'acme/app' },
        sender: { login: 'octocat' },
      },
      receiver
    );
    if (result.kind !== 'logs') throw new Error('expected logs');
    expect(result.logs[0].level).toBe('error');
    expect(result.logs[0].message).toBe('Deployment to production: failure');
  });

  it('skips unsupported events', () => {
    const result = githubAdapter(
      { action: 'opened', issue: { number: 1 }, repository: { full_name: 'acme/app' } },
      receiver
    );
    expect(result.kind).toBe('skipped');
  });
});
