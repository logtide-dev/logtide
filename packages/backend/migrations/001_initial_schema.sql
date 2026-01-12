-- ============================================================================
-- LogTide - Complete Database Schema (Fully Consolidated)
-- ============================================================================
-- This file contains the complete database schema for LogTide.
-- It includes all tables, indexes, constraints, and TimescaleDB configurations.
-- All previous migrations have been consolidated into this single schema file.
--
-- Version: 3.0.0 (Final Consolidated Schema)
-- Last Updated: 25-11-2025
-- Database: PostgreSQL 16 + TimescaleDB
-- Replaces: 001-004 individual migration files
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  disabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

-- Organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations (slug);
CREATE INDEX IF NOT EXISTS idx_organizations_owner_id ON organizations (owner_id);

-- Organization members table
CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_members_org_id ON organization_members (organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_user_id ON organization_members (user_id);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_projects_organization_id ON projects (organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects (user_id);

-- API Keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys (key_hash) WHERE NOT revoked;
CREATE INDEX IF NOT EXISTS idx_api_keys_project_id ON api_keys (project_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_project_hash ON api_keys (project_id, key_hash) WHERE NOT revoked;

-- ============================================================================
-- LOGS & MONITORING TABLES
-- ============================================================================

-- Logs table (TimescaleDB Hypertable)
CREATE TABLE IF NOT EXISTS logs (
  time TIMESTAMPTZ NOT NULL,
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  service VARCHAR(100) NOT NULL,
  level VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB,
  trace_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (time, id)
);

-- Convert to TimescaleDB hypertable (only if not already a hypertable)
SELECT create_hypertable('logs', 'time', if_not_exists => TRUE);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_logs_project_id ON logs (project_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_logs_service ON logs (service, time DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs (level, time DESC);
CREATE INDEX IF NOT EXISTS idx_logs_trace_id ON logs (trace_id, time DESC) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_logs_message_fulltext ON logs USING gin(to_tsvector('english', message));

-- Optimized composite indexes (Phase 2.1)
CREATE INDEX IF NOT EXISTS idx_logs_service_level_time ON logs (service, level, time DESC);
CREATE INDEX IF NOT EXISTS idx_logs_project_time ON logs (project_id, time DESC);

-- Retention policy (drop chunks older than 90 days)
SELECT add_retention_policy('logs', INTERVAL '90 days', if_not_exists => TRUE);

-- Alert rules table
CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  service VARCHAR(100),
  level VARCHAR(20)[] NOT NULL,
  threshold INTEGER NOT NULL,
  time_window INTEGER NOT NULL,
  email_recipients VARCHAR(255)[] NOT NULL DEFAULT '{}',
  webhook_url TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_organization_id ON alert_rules (organization_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_project_id ON alert_rules (project_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules (enabled) WHERE enabled = true;

-- Alert history table (TimescaleDB Hypertable)
CREATE TABLE IF NOT EXISTS alert_history (
  time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  log_count INTEGER NOT NULL,
  notified BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  PRIMARY KEY (time, id)
);

-- Convert to TimescaleDB hypertable
SELECT create_hypertable('alert_history', 'time', if_not_exists => TRUE);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_alert_history_rule_id ON alert_history (rule_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_history_triggered_at ON alert_history (triggered_at DESC);

-- Retention policy for alert_history (keep 1 year)
SELECT add_retention_policy('alert_history', INTERVAL '365 days', if_not_exists => TRUE);

-- ============================================================================
-- SIGMA RULES TABLE (Security Detection)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sigma_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,

  -- Sigma metadata
  sigma_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  author TEXT,
  date DATE,
  level TEXT,  -- informational, low, medium, high, critical
  status TEXT, -- experimental, test, stable

  -- Detection logic
  logsource JSONB,  -- {product, service, category}
  detection JSONB,  -- Original Sigma detection logic

  -- LogTide conversion (deprecated - Sigma rules now handle notifications independently)
  alert_rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
  conversion_status TEXT,  -- success, partial, failed
  conversion_notes TEXT,

  -- Notification settings (independent from alert rules)
  email_recipients TEXT[] DEFAULT '{}',  -- Email addresses to notify when this Sigma rule matches
  webhook_url TEXT,                      -- Webhook URL to call when this Sigma rule matches

  -- Phase 3: MITRE ATT&CK & SigmaHQ Integration
  tags TEXT[],                  -- Sigma tags (e.g., attack.t1059, attack.execution)
  mitre_tactics TEXT[],         -- MITRE ATT&CK tactics (e.g., execution, persistence)
  mitre_techniques TEXT[],      -- MITRE ATT&CK techniques (e.g., T1059, T1053)
  sigmahq_path TEXT,            -- Original path in SigmaHQ repository
  sigmahq_commit TEXT,          -- Commit hash at import time
  last_synced_at TIMESTAMPTZ,   -- Last sync timestamp

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Standard indexes
CREATE INDEX IF NOT EXISTS idx_sigma_rules_org ON sigma_rules (organization_id);
CREATE INDEX IF NOT EXISTS idx_sigma_rules_project ON sigma_rules (project_id);
CREATE INDEX IF NOT EXISTS idx_sigma_rules_level ON sigma_rules (level);
CREATE INDEX IF NOT EXISTS idx_sigma_rules_status ON sigma_rules (status);
CREATE INDEX IF NOT EXISTS idx_sigma_rules_alert ON sigma_rules (alert_rule_id);

-- Phase 3: GIN indexes for array fields (efficient ANY/ALL queries)
CREATE INDEX IF NOT EXISTS idx_sigma_rules_tags ON sigma_rules USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_sigma_rules_mitre_techniques ON sigma_rules USING GIN (mitre_techniques);
CREATE INDEX IF NOT EXISTS idx_sigma_rules_mitre_tactics ON sigma_rules USING GIN (mitre_tactics);

-- Phase 3: SigmaHQ path index for versioning
CREATE INDEX IF NOT EXISTS idx_sigma_rules_sigmahq_path ON sigma_rules (sigmahq_path);

-- ============================================================================
-- NOTIFICATIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications (user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_org ON notifications (organization_id);
CREATE INDEX IF NOT EXISTS idx_notifications_project ON notifications (project_id);

-- ============================================================================
-- MIGRATION TRACKING TABLES (Kysely)
-- ============================================================================

CREATE TABLE IF NOT EXISTS kysely_migration (
  name VARCHAR(255) NOT NULL PRIMARY KEY,
  timestamp VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS kysely_migration_lock (
  id VARCHAR(255) NOT NULL PRIMARY KEY,
  is_locked INTEGER DEFAULT 0 NOT NULL
);

-- Insert default lock row
INSERT INTO kysely_migration_lock (id, is_locked)
VALUES ('migration_lock', 0)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- TIMESCALEDB COMPRESSION POLICIES
-- ============================================================================

-- Enable compression on logs hypertable
ALTER TABLE logs SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'project_id',
  timescaledb.compress_orderby = 'time DESC'
);

-- Add compression policy for logs (compress chunks older than 7 days)
SELECT add_compression_policy('logs', INTERVAL '7 days', if_not_exists => TRUE);

-- Enable compression on alert_history hypertable
ALTER TABLE alert_history SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'rule_id',
  timescaledb.compress_orderby = 'time DESC'
);

-- Add compression policy for alert_history (compress chunks older than 30 days)
SELECT add_compression_policy('alert_history', INTERVAL '30 days', if_not_exists => TRUE);

-- ============================================================================
-- SUMMARY
-- ============================================================================

-- Core Tables: users, sessions, organizations, organization_members, projects, api_keys
-- Log Tables: logs (hypertable), alert_rules, alert_history (hypertable)
-- Security Tables: sigma_rules
-- Notification Tables: notifications
-- System Tables: kysely_migration, kysely_migration_lock

-- Total Tables: 13
-- Total Hypertables: 2 (logs, alert_history)
-- Total Indexes: ~40
-- Total Foreign Keys: ~20

-- ============================================================================
-- FEATURES
-- ============================================================================

-- 1. TimescaleDB Features:
--    - logs: Hypertable with automatic compression (7d) and retention (90d)
--    - alert_history: Hypertable with automatic compression (30d) and retention (365d)
--    - Compression reduces storage by ~90% for older data
--    - Segment-by optimization for efficient queries

-- 2. Security:
--    - All passwords stored as bcrypt hashes
--    - API keys stored as hashes
--    - Session tokens are unique UUIDs
--    - Cascade deletes to maintain referential integrity
--    - User accounts can be disabled (soft delete)
--    - Admin role support for privileged operations

-- 3. Performance:
--    - Composite indexes on foreign keys + timestamps
--    - GIN index for full-text search on log messages
--    - Partial indexes on active records (e.g., not revoked API keys)
--    - Optimized composite indexes for common filter combinations
--    - GIN indexes for Sigma rule array fields (MITRE tags, tactics, techniques)

-- 4. Sigma Rules (Security Detection):
--    - Import/export Sigma YAML rules
--    - Independent notification system (email + webhooks)
--    - MITRE ATT&CK framework mapping
--    - SigmaHQ integration support (path tracking, version control)
--    - Full metadata preservation
--    - Backward compatibility with alert rules system

-- 5. Multi-tenancy:
--    - Organization-based isolation
--    - Project-scoped API keys
--    - Member roles and permissions
--    - Cascade deletes maintain data integrity

-- 6. Notifications:
--    - User notifications with read/unread status
--    - Organization and project-level notifications
--    - Flexible metadata support for custom notification types

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
