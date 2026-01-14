-- 005: Aksjebeholdninger og aksjenumre

-- Nåværende beholdninger
CREATE TABLE shareholdings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  shareholder_id UUID NOT NULL REFERENCES shareholders(id) ON DELETE CASCADE,
  share_class_id UUID NOT NULL REFERENCES share_classes(id) ON DELETE CASCADE,
  num_shares INTEGER NOT NULL DEFAULT 0,
  ownership_percentage DECIMAL(7,4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, shareholder_id, share_class_id)
);

-- Aksjenummerserier
CREATE TABLE share_number_ranges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  shareholder_id UUID NOT NULL REFERENCES shareholders(id) ON DELETE CASCADE,
  share_class_id UUID NOT NULL REFERENCES share_classes(id) ON DELETE CASCADE,
  range_start INTEGER NOT NULL,
  range_end INTEGER NOT NULL,
  acquired_transaction_id UUID,
  disposed_transaction_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_range CHECK (range_end >= range_start)
);

-- Indekser
CREATE INDEX idx_shareholdings_company ON shareholdings(company_id);
CREATE INDEX idx_shareholdings_shareholder ON shareholdings(shareholder_id);
CREATE INDEX idx_share_ranges_company_active ON share_number_ranges(company_id, is_active);
CREATE INDEX idx_share_ranges_lookup ON share_number_ranges(company_id, range_start, range_end);
