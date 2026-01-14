# SQL-migrasjoner - Aksjeregistersystem

## Bruk

Kjør disse migrasjonene i Supabase SQL Editor i rekkefølge.

---

## 001 - Enums og extensions

```sql
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
```

---

## 002 - Organisasjoner og brukere

```sql
-- Organisasjoner (tenants)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  org_number VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Brukerprofiler (utvidelse av Supabase Auth)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bruker-organisasjon kobling
CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

-- Indekser
CREATE INDEX idx_organization_members_org ON organization_members(organization_id);
CREATE INDEX idx_organization_members_user ON organization_members(user_id);
```

---

## 003 - Selskaper og aksjeklasser

```sql
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
```

---

## 004 - Aksjonærer

```sql
-- Aksjonærer
CREATE TABLE shareholders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shareholder_type shareholder_type NOT NULL,
  name VARCHAR(255) NOT NULL,
  org_number VARCHAR(20),
  birth_date DATE,
  national_id VARCHAR(255), -- Kryptert fødselsnummer
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
```

---

## 005 - Aksjebeholdninger og aksjenumre

```sql
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
  acquired_transaction_id UUID, -- Settes senere med FK
  disposed_transaction_id UUID, -- Settes senere med FK
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_range CHECK (range_end >= range_start)
);

-- Indekser
CREATE INDEX idx_shareholdings_company ON shareholdings(company_id);
CREATE INDEX idx_shareholdings_shareholder ON shareholdings(shareholder_id);
CREATE INDEX idx_share_ranges_company_active ON share_number_ranges(company_id, is_active);
CREATE INDEX idx_share_ranges_lookup ON share_number_ranges(company_id, range_start, range_end);
```

---

## 006 - Transaksjoner

```sql
-- Transaksjoner
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
```

---

## 007 - Dokumenter

```sql
-- Dokumenter/bilag
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  document_type document_type NOT NULL,
  name VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type VARCHAR(100),
  uploaded_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indekser
CREATE INDEX idx_documents_company ON documents(company_id);
CREATE INDEX idx_documents_transaction ON documents(transaction_id);
```

---

## 008 - Triggere for oppdatering

```sql
-- Funksjon for å oppdatere updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggere
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_shareholders_updated_at
  BEFORE UPDATE ON shareholders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_shareholdings_updated_at
  BEFORE UPDATE ON shareholdings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## 009 - Row Level Security (RLS)

```sql
-- Aktiver RLS på alle tabeller
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE shareholders ENABLE ROW LEVEL SECURITY;
ALTER TABLE shareholdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_number_ranges ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Hjelpefunksjon: Hent brukerens organisasjoner
CREATE OR REPLACE FUNCTION get_user_organizations()
RETURNS SETOF UUID AS $$
  SELECT organization_id
  FROM organization_members
  WHERE user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- Policy: users (brukere ser seg selv)
CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (id = auth.uid());

-- Policy: organizations
CREATE POLICY "Users can view their organizations"
  ON organizations FOR SELECT
  USING (id IN (SELECT get_user_organizations()));

-- Policy: organization_members
CREATE POLICY "Users can view members in their organizations"
  ON organization_members FOR SELECT
  USING (organization_id IN (SELECT get_user_organizations()));

-- Policy: companies
CREATE POLICY "Users can view companies in their organizations"
  ON companies FOR SELECT
  USING (organization_id IN (SELECT get_user_organizations()));

CREATE POLICY "Admins and editors can insert companies"
  ON companies FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'editor')
    )
  );

CREATE POLICY "Admins and editors can update companies"
  ON companies FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'editor')
    )
  );

-- Policy: share_classes
CREATE POLICY "Users can view share_classes"
  ON share_classes FOR SELECT
  USING (
    company_id IN (
      SELECT id FROM companies
      WHERE organization_id IN (SELECT get_user_organizations())
    )
  );

CREATE POLICY "Admins and editors can manage share_classes"
  ON share_classes FOR ALL
  USING (
    company_id IN (
      SELECT c.id FROM companies c
      JOIN organization_members om ON c.organization_id = om.organization_id
      WHERE om.user_id = auth.uid() AND om.role IN ('admin', 'editor')
    )
  );

-- Policy: shareholders
CREATE POLICY "Users can view shareholders"
  ON shareholders FOR SELECT
  USING (organization_id IN (SELECT get_user_organizations()));

CREATE POLICY "Admins and editors can manage shareholders"
  ON shareholders FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'editor')
    )
  );

-- Policy: shareholdings
CREATE POLICY "Users can view shareholdings"
  ON shareholdings FOR SELECT
  USING (
    company_id IN (
      SELECT id FROM companies
      WHERE organization_id IN (SELECT get_user_organizations())
    )
  );

CREATE POLICY "Admins and editors can manage shareholdings"
  ON shareholdings FOR ALL
  USING (
    company_id IN (
      SELECT c.id FROM companies c
      JOIN organization_members om ON c.organization_id = om.organization_id
      WHERE om.user_id = auth.uid() AND om.role IN ('admin', 'editor')
    )
  );

-- Policy: share_number_ranges
CREATE POLICY "Users can view share_number_ranges"
  ON share_number_ranges FOR SELECT
  USING (
    company_id IN (
      SELECT id FROM companies
      WHERE organization_id IN (SELECT get_user_organizations())
    )
  );

CREATE POLICY "Admins and editors can manage share_number_ranges"
  ON share_number_ranges FOR ALL
  USING (
    company_id IN (
      SELECT c.id FROM companies c
      JOIN organization_members om ON c.organization_id = om.organization_id
      WHERE om.user_id = auth.uid() AND om.role IN ('admin', 'editor')
    )
  );

-- Policy: transactions
CREATE POLICY "Users can view transactions"
  ON transactions FOR SELECT
  USING (
    company_id IN (
      SELECT id FROM companies
      WHERE organization_id IN (SELECT get_user_organizations())
    )
  );

CREATE POLICY "Admins and editors can manage transactions"
  ON transactions FOR ALL
  USING (
    company_id IN (
      SELECT c.id FROM companies c
      JOIN organization_members om ON c.organization_id = om.organization_id
      WHERE om.user_id = auth.uid() AND om.role IN ('admin', 'editor')
    )
  );

-- Policy: transaction_lines
CREATE POLICY "Users can view transaction_lines"
  ON transaction_lines FOR SELECT
  USING (
    transaction_id IN (
      SELECT t.id FROM transactions t
      JOIN companies c ON t.company_id = c.id
      WHERE c.organization_id IN (SELECT get_user_organizations())
    )
  );

CREATE POLICY "Admins and editors can manage transaction_lines"
  ON transaction_lines FOR ALL
  USING (
    transaction_id IN (
      SELECT t.id FROM transactions t
      JOIN companies c ON t.company_id = c.id
      JOIN organization_members om ON c.organization_id = om.organization_id
      WHERE om.user_id = auth.uid() AND om.role IN ('admin', 'editor')
    )
  );

-- Policy: documents
CREATE POLICY "Users can view documents"
  ON documents FOR SELECT
  USING (
    company_id IN (
      SELECT id FROM companies
      WHERE organization_id IN (SELECT get_user_organizations())
    )
  );

CREATE POLICY "Admins and editors can manage documents"
  ON documents FOR ALL
  USING (
    company_id IN (
      SELECT c.id FROM companies c
      JOIN organization_members om ON c.organization_id = om.organization_id
      WHERE om.user_id = auth.uid() AND om.role IN ('admin', 'editor')
    )
  );
```

---

## 010 - Hjelpefunksjoner

```sql
-- Funksjon: Finn eier av aksje X
CREATE OR REPLACE FUNCTION find_share_owner(
  p_company_id UUID,
  p_share_number INTEGER
)
RETURNS TABLE (
  shareholder_id UUID,
  shareholder_name VARCHAR,
  range_start INTEGER,
  range_end INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    snr.shareholder_id,
    s.name as shareholder_name,
    snr.range_start,
    snr.range_end
  FROM share_number_ranges snr
  JOIN shareholders s ON snr.shareholder_id = s.id
  WHERE snr.company_id = p_company_id
    AND snr.is_active = TRUE
    AND p_share_number BETWEEN snr.range_start AND snr.range_end;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funksjon: Beregn eierandeler for et selskap
CREATE OR REPLACE FUNCTION recalculate_ownership(p_company_id UUID)
RETURNS VOID AS $$
DECLARE
  v_total_shares INTEGER;
BEGIN
  -- Hent totalt antall aksjer
  SELECT total_shares INTO v_total_shares
  FROM companies WHERE id = p_company_id;

  -- Oppdater eierandeler
  UPDATE shareholdings
  SET ownership_percentage =
    CASE WHEN v_total_shares > 0
         THEN (num_shares::DECIMAL / v_total_shares) * 100
         ELSE 0
    END
  WHERE company_id = p_company_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funksjon: Neste ledige aksjenummer
CREATE OR REPLACE FUNCTION get_next_share_number(p_company_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_max INTEGER;
BEGIN
  SELECT COALESCE(MAX(range_end), 0) INTO v_max
  FROM share_number_ranges
  WHERE company_id = p_company_id;

  RETURN v_max + 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 011 - Trigger for automatisk brukeropprettelse

```sql
-- Opprett brukerprofil automatisk ved signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO users (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

---

## Verifisering

Etter å ha kjørt alle migrasjoner, verifiser med:

```sql
-- Sjekk at alle tabeller er opprettet
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Sjekk at RLS er aktivert
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';
```
