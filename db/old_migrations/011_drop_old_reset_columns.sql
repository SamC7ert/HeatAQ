-- Migration: 011_drop_old_reset_columns.sql
-- Description: Remove unused password reset columns from users table
-- Date: 2024-11-30
-- Note: Run AFTER 010_password_reset_tables.sql

-- These columns were from an older approach, replaced by password_reset_tokens table
ALTER TABLE users DROP COLUMN IF EXISTS password_reset_token;
ALTER TABLE users DROP COLUMN IF EXISTS password_reset_expires;
