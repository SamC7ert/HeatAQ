-- 009: Row Level Security (RLS)

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

-- Policy: users
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
