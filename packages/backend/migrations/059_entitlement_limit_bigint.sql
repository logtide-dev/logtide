-- ============================================================================
-- Migration 059: widen organization_entitlements.limit_value to BIGINT
-- INTEGER capped every limit at 2^31 - 1, so any byte quota of 2 GiB or more
-- (e.g. 10 GiB = 10737418240) failed with "integer out of range". BIGINT holds
-- every value the API accepts; the application keeps limits within
-- Number.MAX_SAFE_INTEGER and coerces the int8 string the pg driver returns
-- back to a number when reading the column.
-- ============================================================================

ALTER TABLE organization_entitlements ALTER COLUMN limit_value TYPE BIGINT;
