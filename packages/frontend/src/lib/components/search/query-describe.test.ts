import { describe, it, expect } from 'vitest';
import { parseLogQuery, type LogSearchQuery } from '@logtide/shared';
import { describeQuery } from './query-describe';

function parse(input: string): LogSearchQuery {
  const res = parseLogQuery(input);
  if (res.ok === false) throw new Error(res.error.message);
  return res.query;
}

describe('describeQuery', () => {
  it('describes every clause kind', () =>
    expect(
      describeQuery(
        parse('timeout "conn refused" -debug a OR b level:(error OR critical) -service:api user.id:* -tmp:* path:*admin*'),
      ),
    ).toEqual([
      'Message contains the word "timeout"',
      'Message contains "conn refused"',
      'Message contains any of "a", "b"',
      'Message does not contain "debug"',
      'Level is one of error, critical',
      'Service is not api',
      'Metadata user.id exists',
      'Metadata tmp does not exist',
      'Metadata path contains admin',
    ]));

  it('describes equals, none-of and the remaining built-in labels', () =>
    expect(describeQuery(parse('host:web-1 -hostname:(a OR b) trace:t1 session:s1 span:sp1 env:prod'))).toEqual([
      'Host is web-1',
      'Host is none of a, b',
      'Trace is t1',
      'Session is s1',
      'Span is sp1',
      'Metadata env is prod',
    ]));

  it('returns nothing for an empty query', () => expect(describeQuery(parse(''))).toEqual([]));
});
