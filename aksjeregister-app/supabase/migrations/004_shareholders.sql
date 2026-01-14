-- 004: Aksjonærer

CREATE TABLE shareholders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shareholder_type shareholder_type NOT NULL,
  name VARCHAR(255) NOT NULL,
  org_number VARCHAR(20),
  birth_date DATE,
  national_id VARCHAR(255),
  address TEXT,
  postal_code VARCHAR(10),
  city VARCHAR(100),
  country VARCHAR(2) NOT NULL DEFAULT 'NO',
  email VARCHAR(255),
  phone VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indekser
CREATE INDEX idx_shareholders_org ON shareholders(organization_id);
CREATE INDEX idx_shareholders_org_number ON shareholders(org_number);
CREATE INDEX idx_shareholders_type ON shareholders(shareholder_type);
