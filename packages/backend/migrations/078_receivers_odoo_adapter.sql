-- ============================================================================
-- Migration 078: Odoo receiver adapter
-- Adds 'odoo' to the receivers adapter_type check constraint.
-- ============================================================================

ALTER TABLE receivers DROP CONSTRAINT IF EXISTS receivers_adapter_type_check;
ALTER TABLE receivers
  ADD CONSTRAINT receivers_adapter_type_check
  CHECK (adapter_type IN ('github', 'uptime', 'odoo', 'generic'));
