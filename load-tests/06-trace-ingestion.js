// Trace ingestion load test (issue #309) - OTLP/JSON batches like an
// OpenTelemetry Collector batch processor sends them: many distinct traces
// per request, and traces whose spans are split across several requests.
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { BASE_URL, apiKeyHeaders, generateTraceId } from './config.js';

const spansIngested = new Counter('spans_ingested');
const traceErrors = new Rate('trace_ingest_errors');
const traceDuration = new Trend('trace_ingest_duration', true);

export const options = {
  scenarios: {
    // 20 req/s x 200 spans over 200 distinct traces = 4,000 spans/s
    distinctTraces: {
      executor: 'constant-arrival-rate',
      rate: 20,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 20,
      maxVUs: 60,
      exec: 'distinctTraces',
      startTime: '0s',
    },
    // 20 req/s x 100 spans; every trace is split over two requests (root last)
    splitTraces: {
      executor: 'constant-arrival-rate',
      rate: 20,
      timeUnit: '1s',
      duration: '2m',
      preAllocatedVUs: 20,
      maxVUs: 60,
      exec: 'splitTraces',
      startTime: '2m30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    trace_ingest_errors: ['rate<0.01'],
    trace_ingest_duration: ['p(95)<500', 'p(99)<1000'],
  },
};

function spanId() {
  return generateTraceId().slice(0, 16);
}

function span(traceId, id, parentId, name, startMs, endMs, error) {
  return {
    traceId,
    spanId: id,
    ...(parentId ? { parentSpanId: parentId } : {}),
    name,
    kind: parentId ? 3 : 2,
    startTimeUnixNano: `${startMs}000000`,
    endTimeUnixNano: `${endMs}000000`,
    status: { code: error ? 2 : 1 },
    attributes: [{ key: 'http.method', value: { stringValue: 'GET' } }],
  };
}

function send(spans, scenario) {
  const body = {
    resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'load-test' } }] },
      scopeSpans: [{ spans }],
    }],
  };
  const start = Date.now();
  const res = http.post(`${BASE_URL}/v1/otlp/traces`, JSON.stringify(body), {
    headers: apiKeyHeaders,
    tags: { scenario },
  });
  traceDuration.add(Date.now() - start);
  const ok = check(res, { 'trace ingest ok': (r) => r.status === 200 });
  if (ok) spansIngested.add(spans.length);
  else traceErrors.add(1);
}

export function distinctTraces() {
  const now = Date.now();
  const spans = [];
  for (let i = 0; i < 200; i++) {
    spans.push(span(generateTraceId(), spanId(), null, 'GET /items', now - 50, now, i % 50 === 0));
  }
  send(spans, 'distinct_traces');
}

// Pending second halves, sent by the next iteration of the same VU.
let pending = [];

export function splitTraces() {
  const now = Date.now();
  const spans = pending;
  pending = [];
  for (let i = 0; i < 25; i++) {
    const traceId = generateTraceId();
    const rootId = spanId();
    spans.push(span(traceId, spanId(), rootId, 'db.query', now - 80, now - 60, false));
    spans.push(span(traceId, spanId(), rootId, 'cache.get', now - 50, now - 45, false));
    pending.push(span(traceId, spanId(), rootId, 'queue.publish', now - 40, now - 10, i % 10 === 0));
    pending.push(span(traceId, rootId, null, 'POST /orders', now - 100, now, false));
  }
  send(spans, 'split_traces');
}
