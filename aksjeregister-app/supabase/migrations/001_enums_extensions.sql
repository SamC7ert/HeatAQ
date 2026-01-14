-- 001: Enums og extensions
-- Kjør først i Supabase SQL Editor

-- Aktiver nødvendige extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enum: Brukerroller
CREATE TYPE user_role AS ENUM ('admin', 'editor', 'viewer');

-- Enum: Aksjonærtype
CREATE TYPE shareholder_type AS ENUM ('person', 'company');

-- Enum: Transaksjonstype
CREATE TYPE transaction_type AS ENUM (
  'founding',         -- Stiftelse
  'transfer',         -- Salg/overføring
  'issue',            -- Emisjon
  'dividend',         -- Utbytte
  'inheritance',      -- Arv
  'gift',             -- Gave
  'capital_reduction',-- Kapitalnedsettelse
  'split',            -- Aksjesplitt
  'reverse_split',    -- Aksjespleis
  'merger',           -- Fusjon
  'demerger'          -- Fisjon
);

-- Enum: Retning (inn/ut)
CREATE TYPE transaction_direction AS ENUM ('in', 'out');

-- Enum: Dokumenttype
CREATE TYPE document_type AS ENUM (
  'founding_document',
  'articles',
  'opening_balance',
  'share_purchase_agreement',
  'board_approval',
  'preemption_waiver',
  'general_meeting_protocol',
  'subscription_form',
  'share_certificate',
  'company_certificate',
  'other'
);
