import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sessionsAPI } from './sessions';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('sessionsAPI', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sessions api encodes slash in session id', async () => {
    fetchMock.mockResolvedValue(json(200, { events: [], window: null, truncated: false }));
    await sessionsAPI.getSessionEvents({ projectId: 'p1', sessionId: 'a/b cè' });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/sessions/a%2Fb%20c%C3%A8/events');
    expect(url).toContain('projectId=p1');
  });

  it('sends the cursor and no offset when listing', async () => {
    fetchMock.mockResolvedValue(json(200, { sessions: [] }));
    await sessionsAPI.listSessions({ projectId: 'p1', cursor: 'abc', limit: 25, hasErrors: true });

    const parsed = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost');
    expect(parsed.searchParams.get('cursor')).toBe('abc');
    expect(parsed.searchParams.get('limit')).toBe('25');
    expect(parsed.searchParams.get('hasErrors')).toBe('true');
    expect(parsed.searchParams.has('offset')).toBe(false);
  });

  it('non-2xx rejects with the server error text', async () => {
    fetchMock.mockResolvedValue(json(404, { error: 'Session not found' }));
    await expect(sessionsAPI.getSessionEvents({ projectId: 'p1', sessionId: 'x' })).rejects.toThrow(
      'Session not found',
    );
  });
});
