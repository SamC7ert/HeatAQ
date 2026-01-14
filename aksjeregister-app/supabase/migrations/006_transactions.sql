-- 006: Transaksjoner

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  transaction_type transaction_type NOT NULL,
  transaction_date DATE NOT NULL,
  effective_date DATE,
  decision_date DATE,
  description TEXT,
  shares_before INTEGER NOT NULL DEFAULT 0,
  shares_after INTEGER NOT NULL DEFAULT 0,
  capital_before DECIMAL(15,2) NOT NULL DEFAULT 0,
  capital_after DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(15,2),
  price_per_share DECIMAL(10,2),
  dividend_per_share DECIMAL(10,2),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transaksjonslinjer
CREATE TABLE transaction_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  shareholder_id UUID NOT NULL REFERENCES shareholders(id) ON DELETE CASCADE,
  share_class_id UUID NOT NULL REFERENCES share_classes(id) ON DELETE CASCADE,
  direction transaction_direction NOT NULL,
  num_shares INTEGER NOT NULL,
  share_numbers_text TEXT,
  amount DECIMAL(15,2),
  price_per_share DECIMAL(10,2),
  acquisition_cost DECIMAL(15,2),
  counterparty_id UUID REFERENCES shareholders(id),
  withholding_tax_rate DECIMAL(5,2),
  withholding_tax_amount DECIMAL(15,2),
  net_amount DECIMAL(15,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Legg til FK for share_number_ranges
ALTER TABLE share_number_ranges
  ADD CONSTRAINT fk_acquired_transaction
  FOREIGN KEY (acquired_transaction_id) REFERENCES transactions(id);

ALTER TABLE share_number_ranges
  ADD CONSTRAINT fk_disposed_transaction
  FOREIGN KEY (disposed_transaction_id) REFERENCES transactions(id);

-- Indekser
CREATE INDEX idx_transactions_company_date ON transactions(company_id, transaction_date);
CREATE INDEX idx_transactions_type ON transactions(transaction_type);
CREATE INDEX idx_transaction_lines_transaction ON transaction_lines(transaction_id);
CREATE INDEX idx_transaction_lines_shareholder ON transaction_lines(shareholder_id);
