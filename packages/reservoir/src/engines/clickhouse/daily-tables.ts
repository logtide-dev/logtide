// ClickHouse layouts of the logs and spans tables (1.6.3 and later).
//
// Partitioned by day so retention drops whole days (see repartition.ts). The
// indexes and projections are declared in the statement, so a table created
// here is complete without the ALTERs that bring pre-1.6.3 tables up to date.
// There is no full-copy projection: proj_service_time doubled every write of
// these tables and the reads that used it are served by proj_minute_volume
// (logs) or were rare (spans).

import { DAILY_PARTITION_KEY } from './repartition.js';

export function logsTableDdl(name: string, ifNotExists = false): string {
  return `
    CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${name} (
      id UUID DEFAULT generateUUIDv4(),
      time DateTime64(3) NOT NULL,
      project_id String NOT NULL,
      service LowCardinality(String) NOT NULL,
      level LowCardinality(String) NOT NULL,
      message String NOT NULL,
      metadata String DEFAULT '{}',
      trace_id Nullable(String) DEFAULT NULL,
      span_id Nullable(String) DEFAULT NULL,
      session_id Nullable(String) DEFAULT NULL,
      created_at DateTime DEFAULT now(),
      hostname String MATERIALIZED JSONExtractString(metadata, 'hostname'),
      INDEX idx_message_fulltext message TYPE ngrambf_v1(3, 32768, 3, 0) GRANULARITY 1,
      INDEX idx_message_lower_ngram lowerUTF8(message) TYPE ngrambf_v1(3, 32768, 3, 0) GRANULARITY 1,
      INDEX idx_trace_id trace_id TYPE bloom_filter(0.01) GRANULARITY 1,
      INDEX idx_id id TYPE bloom_filter(0.01) GRANULARITY 1,
      INDEX idx_span_id span_id TYPE bloom_filter(0.01) GRANULARITY 1,
      INDEX idx_session_id session_id TYPE bloom_filter(0.01) GRANULARITY 1,
      PROJECTION proj_minute_volume (
        SELECT project_id, toStartOfMinute(time), level, service, count()
        GROUP BY project_id, toStartOfMinute(time), level, service
      )
    )
    ENGINE = MergeTree()
    PARTITION BY ${DAILY_PARTITION_KEY}
    ORDER BY (project_id, time)
    SETTINGS index_granularity = 8192
  `;
}

export function spansTableDdl(name: string, ifNotExists = false): string {
  return `
    CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${name} (
      time DateTime64(3) NOT NULL,
      span_id String NOT NULL,
      trace_id String NOT NULL,
      parent_span_id Nullable(String) DEFAULT NULL,
      organization_id Nullable(String) DEFAULT NULL,
      project_id String NOT NULL,
      service_name LowCardinality(String) NOT NULL,
      operation_name String NOT NULL,
      start_time DateTime64(3) NOT NULL,
      end_time DateTime64(3) NOT NULL,
      duration_ms UInt32 NOT NULL,
      kind LowCardinality(Nullable(String)) DEFAULT NULL,
      status_code LowCardinality(Nullable(String)) DEFAULT NULL,
      status_message Nullable(String) DEFAULT NULL,
      attributes String DEFAULT '{}',
      events String DEFAULT '[]',
      links String DEFAULT '[]',
      resource_attributes String DEFAULT '{}',
      INDEX idx_spans_trace_id trace_id TYPE bloom_filter(0.01) GRANULARITY 1,
      INDEX idx_spans_parent parent_span_id TYPE bloom_filter(0.01) GRANULARITY 1
    )
    ENGINE = MergeTree()
    PARTITION BY ${DAILY_PARTITION_KEY}
    ORDER BY (project_id, trace_id, time)
    SETTINGS index_granularity = 8192
  `;
}
