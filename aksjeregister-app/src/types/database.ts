// Database types for Aksjeregister
// These types match the schema defined in 03-SQL-MIGRASJONER.md

export type UserRole = "admin" | "editor" | "viewer";
export type ShareholderType = "person" | "company";
export type TransactionType =
  | "founding"
  | "transfer"
  | "issue"
  | "dividend"
  | "inheritance"
  | "gift"
  | "capital_reduction"
  | "split"
  | "reverse_split"
  | "merger"
  | "demerger";
export type TransactionDirection = "in" | "out";
export type DocumentType =
  | "founding_document"
  | "articles"
  | "opening_balance"
  | "share_purchase_agreement"
  | "board_approval"
  | "preemption_waiver"
  | "general_meeting_protocol"
  | "subscription_form"
  | "share_certificate"
  | "company_certificate"
  | "other";

export interface Organization {
  id: string;
  name: string;
  org_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user_id: string;
  role: UserRole;
  created_at: string;
}

export interface Company {
  id: string;
  organization_id: string;
  name: string;
  org_number: string;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  founding_date: string | null;
  share_capital: number;
  total_shares: number;
  par_value: number;
  paid_in_capital: number | null;
  paid_in_premium: number | null;
  created_at: string;
  updated_at: string;
}

export interface ShareClass {
  id: string;
  company_id: string;
  name: string;
  voting_rights: number;
  dividend_rights: number;
  total_shares: number;
  created_at: string;
}

export interface Shareholder {
  id: string;
  organization_id: string;
  shareholder_type: ShareholderType;
  name: string;
  org_number: string | null;
  birth_date: string | null;
  national_id: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export interface Shareholding {
  id: string;
  company_id: string;
  shareholder_id: string;
  share_class_id: string;
  num_shares: number;
  ownership_percentage: number;
  updated_at: string;
}

export interface ShareNumberRange {
  id: string;
  company_id: string;
  shareholder_id: string;
  share_class_id: string;
  range_start: number;
  range_end: number;
  acquired_transaction_id: string | null;
  disposed_transaction_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Transaction {
  id: string;
  company_id: string;
  transaction_type: TransactionType;
  transaction_date: string;
  effective_date: string | null;
  decision_date: string | null;
  description: string | null;
  shares_before: number;
  shares_after: number;
  capital_before: number;
  capital_after: number;
  total_amount: number | null;
  price_per_share: number | null;
  dividend_per_share: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransactionLine {
  id: string;
  transaction_id: string;
  shareholder_id: string;
  share_class_id: string;
  direction: TransactionDirection;
  num_shares: number;
  share_numbers_text: string | null;
  amount: number | null;
  price_per_share: number | null;
  acquisition_cost: number | null;
  counterparty_id: string | null;
  withholding_tax_rate: number | null;
  withholding_tax_amount: number | null;
  net_amount: number | null;
  created_at: string;
}

export interface Document {
  id: string;
  company_id: string;
  transaction_id: string | null;
  document_type: DocumentType;
  name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

// Supabase Database type
export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: Organization;
        Insert: Omit<Organization, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Organization, "id">>;
      };
      users: {
        Row: User;
        Insert: Omit<User, "created_at">;
        Update: Partial<Omit<User, "id">>;
      };
      organization_members: {
        Row: OrganizationMember;
        Insert: Omit<OrganizationMember, "id" | "created_at">;
        Update: Partial<Omit<OrganizationMember, "id">>;
      };
      companies: {
        Row: Company;
        Insert: Omit<Company, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Company, "id">>;
      };
      share_classes: {
        Row: ShareClass;
        Insert: Omit<ShareClass, "id" | "created_at">;
        Update: Partial<Omit<ShareClass, "id">>;
      };
      shareholders: {
        Row: Shareholder;
        Insert: Omit<Shareholder, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Shareholder, "id">>;
      };
      shareholdings: {
        Row: Shareholding;
        Insert: Omit<Shareholding, "id" | "updated_at">;
        Update: Partial<Omit<Shareholding, "id">>;
      };
      share_number_ranges: {
        Row: ShareNumberRange;
        Insert: Omit<ShareNumberRange, "id" | "created_at">;
        Update: Partial<Omit<ShareNumberRange, "id">>;
      };
      transactions: {
        Row: Transaction;
        Insert: Omit<Transaction, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Transaction, "id">>;
      };
      transaction_lines: {
        Row: TransactionLine;
        Insert: Omit<TransactionLine, "id" | "created_at">;
        Update: Partial<Omit<TransactionLine, "id">>;
      };
      documents: {
        Row: Document;
        Insert: Omit<Document, "id" | "uploaded_at">;
        Update: Partial<Omit<Document, "id">>;
      };
    };
  };
}
