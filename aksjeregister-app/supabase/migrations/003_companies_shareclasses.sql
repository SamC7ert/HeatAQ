-- 003: Selskaper og aksjeklasser

-- Selskaper
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  org_number VARCHAR(20) NOT NULL,
  address TEXT,
  postal_code VARCHAR(10),
  city VARCHAR(100),
  founding_date DATE,
  share_capital DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_shares INTEGER NOT NULL DEFAULT 0,
  par_value DECIMAL(10,2) NOT NULL DEFAULT 0,
  paid_in_capital DECIMAL(15,2),
  paid_in_premium DECIMAL(15,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Aksjeklasser
CREATE TABLE share_classes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL DEFAULT 'Ordinære',
  voting_rights DECIMAL(5,2) NOT NULL DEFAULT 1.0,
  dividend_rights DECIMAL(5,2) NOT NULL DEFAULT 1.0,
  total_shares INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indekser
CREATE INDEX idx_companies_org ON companies(organization_id);
CREATE UNIQUE INDEX idx_companies_org_number ON companies(org_number);
CREATE INDEX idx_share_classes_company ON share_classes(company_id);
