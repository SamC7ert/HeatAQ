# Datamodell - Aksjeregistersystem

## Oversikt

Datamodellen følger prinsippet "aksjeregister = regnskap for eierskap":

| Regnskap | Aksjeregister |
|----------|---------------|
| Konto | Aksjonær |
| Saldo | Antall aksjer + aksjenumre |
| Bilag | Transaksjonsdokumentasjon |
| Postering | Transaksjonslinje |
| Avstemming | Sum aksjer = Totalt utstedt |

---

## Entitetsrelasjonsdiagram

```
organizations (Kunde/Tenant)
├── users (via organization_members)
├── companies (Aksjeselskaper)
│   ├── share_classes (Aksjeklasser)
│   ├── transactions (Hendelser)
│   │   ├── transaction_lines (Per aksjonær)
│   │   └── documents (Bilag)
│   ├── shareholdings (Nåværende beholdning)
│   └── share_number_ranges (Aksjenummerserier)
└── shareholders (Aksjonærer - delt på tvers av selskaper)
```

---

## Tabelldefinisjoner

### organizations

Kunder/tenants - f.eks. et regnskapsbyrå som administrerer flere selskaper.

| Kolonne | Type | Nullable | Beskrivelse |
|---------|------|----------|-------------|
| id | UUID | PK | Primærnøkkel |
| name | VARCHAR(255) | NOT NULL | Kundenavn |
| org_number | VARCHAR(20) | NULL | Org.nr. for kunden selv |
| created_at | TIMESTAMPTZ | NOT NULL | Opprettet |
| updated_at | TIMESTAMPTZ | NOT NULL | Sist oppdatert |

---

### users

Brukere som logger inn. Kobles til Supabase Auth.

| Kolonne | Type | Nullable | Beskrivelse |
|---------|------|----------|-------------|
| id | UUID | PK | Supabase Auth user ID |
| email | VARCHAR(255) | NOT NULL | E-postadresse |
| full_name | VARCHAR(255) | NULL | Fullt navn |
| created_at | TIMESTAMPTZ | NOT NULL | Opprettet |

---

### organization_members

Kobler brukere til organisasjoner med roller.

| Kolonne | Type | Nullable | Beskrivelse |
|---------|------|----------|-------------|
| id | UUID | PK | Primærnøkkel |
| organization_id | UUID | FK | Referanse til organizations |
| user_id | UUID | FK | Referanse til users |
| role | ENUM | NOT NULL | 'admin', 'editor', 'viewer' |
| created_at | TIMESTAMPTZ | NOT NULL | Opprettet |

**Unik constraint:** (organization_id, user_id)

---

### companies

Aksjeselskapene som administreres.

| Kolonne | Type | Nullable | Beskrivelse |
|---------|------|----------|-------------|
| id | UUID | PK | Primærnøkkel |
| organization_id | UUID | FK | Tilhører organisasjon |
| name | VARCHAR(255) | NOT NULL | Selskapsnavn |
| org_number | VARCHAR(20) | NOT NULL | Organisasjonsnummer |
| address | TEXT | NULL | Forretningsadresse |
| postal_code | VARCHAR(10) | NULL | Postnummer |
| city | VARCHAR(100) | NULL | Poststed |
| founding_date | DATE | NULL | Stiftelsesdato |
| share_capital | DECIMAL(15,2) | NOT NULL | Aksjekapital (NOK) |
| total_shares | INTEGER | NOT NULL | Totalt antall aksjer |
| par_value | DECIMAL(10,2) | NOT NULL | Pålydende per aksje |
| paid_in_capital | DECIMAL(15,2) | NULL | Innbetalt aksjekapital |
| paid_in_premium | DECIMAL(15,2) | NULL | Innbetalt overkurs |
| created_at | TIMESTAMPTZ | NOT NULL | Opprettet |
| updated_at | TIMESTAMPTZ | NOT NULL | Sist oppdatert |

**Beregning:** share_capital = total_shares × par_value

---

### share_classes

Støtter selskaper med flere aksjeklasser.

| Kolonne | Type | Nullable | Beskrivelse |
|---------|------|----------|-------------|
| id | UUID | PK | Primærnøkkel |
| company_id | UUID | FK | Tilhører selskap |
| name | VARCHAR(100) | NOT NULL | Navn: 'Ordinære', 'A', 'B' |
| voting_rights | DECIMAL(5,2) | NOT NULL | Stemmerett per aksje |
| dividend_rights | DECIMAL(5,2) | NOT NULL | Utbytterett (1.0 = 100%) |
| total_shares | INTEGER | NOT NULL | Antall aksjer i klassen |
| created_at | TIMESTAMPTZ | NOT NULL | Opprettet |

---

### shareholders

Aksjonærer - personer eller selskaper. Delt på tvers av selskaper i samme organisasjon.

| Kolonne | Type | Nullable | Beskrivelse |
|---------|------|----------|-------------|
| id | UUID | PK | Primærnøkkel |
| organization_id | UUID | FK | Tilhører organisasjon |
| shareholder_type | ENUM | NOT NULL | 'person', 'company' |
| name | VARCHAR(255) | NOT NULL | Navn |
| org_number | VARCHAR(20) | NULL | Org.nr. (hvis selskap) |
| birth_date | DATE | NULL | Fødselsdato (hvis person) |
| national_id | VARCHAR(255) | NULL | Fødselsnr/D-nr (kryptert) |
| address | TEXT | NULL | Adresse |
| postal_code | VARCHAR(10) | NULL | Postnummer |
| city | VARCHAR(100) | NULL | Poststed |
| country | VARCHAR(2) | NOT NULL | Landkode ISO 3166-1 (default 'NO') |
| email | VARCHAR(255) | NULL | E-post (digital adresse) |
| phone | VARCHAR(20) | NULL | Telefon |
| created_at | TIMESTAMPTZ | NOT NULL | Opprettet |
| updated_at | TIMESTAMPTZ | NOT NULL | Sist oppdatert |

---

### shareholdings

Nåværende aksjeinnehav per aksjonær per selskap. Oppdateres ved hver transaksjon.

| Kolonne | Type | Nullable | Beskrivelse |
|---------|------|----------|-------------|
| id | UUID | PK | Primærnøkkel |
| company_id | UUID | FK | Selskap |
| shareholder_id | UUID | FK | Aksjonær |
| share_class_id | UUID | FK | Aksjeklasse |
| num_shares | INTEGER | NOT NULL | Antall aksjer |
| ownership_percentage | DECIMAL(7,4) | NOT NULL | Eierandel i % (beregnet) |
| updated_at | TIMESTAMPTZ | NOT NULL | Sist oppdatert |

**Unik constraint:** (company_id, shareholder_id, share_class_id)

---

### share_number_ranges

Sporer hvilke aksjenumre hver aksjonær eier - muliggjør "hvem eier aksje X?"

| Kolonne | Type | Nullable | Beskrivelse |
|---------|------|----------|-------------|
| id | UUID | PK | Primærnøkkel |
| company_id | UUID | FK | Selskap |
| shareholder_id | UUID | FK | Aksjonær |
| share_class_id | UUID | FK | Aksjeklasse |
| range_start | INTEGER | NOT NULL | Fra aksjenummer |
| range_end | INTEGER | NOT NULL | Til aksjenummer |
| acquired_transaction_id | UUID | FK | Transaksjon der aksjene ble ervervet |
| disposed_transaction_id | UUID | FK NULL | Transaksjon der aksjene ble avhendet |
| is_active | BOOLEAN | NOT NULL | True hvis aksjonæren fortsatt eier disse |
| created_at | TIMESTAMPTZ | NOT NULL | Opprettet |

**Constraint:** range_end >= range_start
**Antall aksjer i serie:** range_end - range_start + 1

---

### transactions

Alle hendelser som påvirker aksjeeierboken.

| Kolonne | Type | Nullable | Beskrivelse |
|---------|------|----------|-------------|
| id | UUID | PK | Primærnøkkel |
| company_id | UUID | FK | Selskap |
| transaction_type | ENUM | NOT NULL | Se liste under |
| transaction_date | DATE | NOT NULL | Dato for hendelsen |
| effective_date | DATE | NULL | Registreringsdato Foretaksreg. |
| decision_date | DATE | NULL | Vedtaksdato (GF/styre) |
| description | TEXT | NULL | Fritekst beskrivelse |
| shares_before | INTEGER | NOT NULL | Totale aksjer før |
| shares_after | INTEGER | NOT NULL | Totale aksjer etter |
| capital_before | DECIMAL(15,2) | NOT NULL | Aksjekapital før |
| capital_after | DECIMAL(15,2) | NOT NULL | Aksjekapital etter |
| total_amount | DECIMAL(15,2) | NULL | Totalbeløp |
| price_per_share | DECIMAL(10,2) | NULL | Pris per aksje |
| dividend_per_share | DECIMAL(10,2) | NULL | Utbytte per aksje |
| created_by | UUID | FK | Bruker som registrerte |
| created_at | TIMESTAMPTZ | NOT NULL | Opprettet |
| updated_at | TIMESTAMPTZ | NOT NULL | Sist oppdatert |

**Transaksjonstyper (ENUM):**

| Type | Beskrivelse | MVP |
|------|-------------|-----|
| founding | Stiftelse | ✅ |
| transfer | Salg/overføring | ✅ |
| issue | Emisjon | ✅ |
| dividend | Utbytte | ✅ |
| inheritance | Arv | Fase 2 |
| gift | Gave | Fase 2 |
| capital_reduction | Kapitalnedsettelse | Fase 2 |
| split | Aksjesplitt | Fase 2 |
| reverse_split | Aksjespleis | Fase 2 |
| merger | Fusjon | Fase 3 |
| demerger | Fisjon | Fase 3 |

---

### transaction_lines

Detaljer per aksjonær for hver transaksjon.

| Kolonne | Type | Nullable | Beskrivelse |
|---------|------|----------|-------------|
| id | UUID | PK | Primærnøkkel |
| transaction_id | UUID | FK | Tilhører transaksjon |
| shareholder_id | UUID | FK | Aksjonær |
| share_class_id | UUID | FK | Aksjeklasse |
| direction | ENUM | NOT NULL | 'in' (tilgang), 'out' (avgang) |
| num_shares | INTEGER | NOT NULL | Antall aksjer |
| share_numbers_text | TEXT | NULL | Aksjenumre som tekst |
| amount | DECIMAL(15,2) | NULL | Beløp (kjøpesum/utbytte) |
| price_per_share | DECIMAL(10,2) | NULL | Pris per aksje |
| acquisition_cost | DECIMAL(15,2) | NULL | Inngangsverdi totalt |
| counterparty_id | UUID | FK NULL | Motpart (selger/kjøper) |
| withholding_tax_rate | DECIMAL(5,2) | NULL | Kildeskatt % |
| withholding_tax_amount | DECIMAL(15,2) | NULL | Kildeskatt beløp |
| net_amount | DECIMAL(15,2) | NULL | Netto etter skatt |
| created_at | TIMESTAMPTZ | NOT NULL | Opprettet |

---

### documents

Dokumentasjon/bilag per transaksjon.

| Kolonne | Type | Nullable | Beskrivelse |
|---------|------|----------|-------------|
| id | UUID | PK | Primærnøkkel |
| company_id | UUID | FK | Selskap |
| transaction_id | UUID | FK NULL | Tilhører transaksjon (kan være NULL for generelle dok) |
| document_type | ENUM | NOT NULL | Se liste under |
| name | VARCHAR(255) | NOT NULL | Filnavn/beskrivelse |
| file_path | TEXT | NOT NULL | Supabase Storage URL |
| file_size | INTEGER | NULL | Filstørrelse i bytes |
| mime_type | VARCHAR(100) | NULL | MIME-type |
| uploaded_by | UUID | FK | Bruker som lastet opp |
| uploaded_at | TIMESTAMPTZ | NOT NULL | Opplastingstidspunkt |

**Dokumenttyper (ENUM):**

| Type | Beskrivelse |
|------|-------------|
| founding_document | Stiftelsesdokument |
| articles | Vedtekter |
| opening_balance | Åpningsbalanse |
| share_purchase_agreement | Aksjekjøpsavtale |
| board_approval | Styregodkjenning |
| preemption_waiver | Forkjøpsrettserklæring |
| general_meeting_protocol | Generalforsamlingsprotokoll |
| subscription_form | Tegningsblankett |
| share_certificate | Aksjebrev |
| company_certificate | Firmaattest |
| other | Annet |

---

## Indekser

| Tabell | Kolonner | Type | Begrunnelse |
|--------|----------|------|-------------|
| companies | organization_id | B-tree | Filtrere per organisasjon |
| companies | org_number | Unique | Unikt org.nr. |
| shareholders | organization_id | B-tree | Filtrere per organisasjon |
| shareholders | org_number | B-tree | Søk på org.nr. |
| shareholdings | (company_id, shareholder_id, share_class_id) | Unique | Én rad per kombinasjon |
| transactions | (company_id, transaction_date) | B-tree | Historikk per selskap |
| transaction_lines | transaction_id | B-tree | Hente linjer for transaksjon |
| share_number_ranges | (company_id, is_active) | B-tree | Finn aktive serier |
| share_number_ranges | (company_id, range_start, range_end) | B-tree | Finn eier av aksje X |
| documents | transaction_id | B-tree | Dokumenter per transaksjon |
| organization_members | (organization_id, user_id) | Unique | Én rolle per bruker per org |

---

## Row Level Security (RLS)

Multi-tenancy sikres med PostgreSQL RLS. Alle tabeller som tilhører en organisasjon har policies:

```sql
-- Eksempel for companies
CREATE POLICY "Users can view companies in their organizations"
ON companies FOR SELECT
USING (
  organization_id IN (
    SELECT organization_id
    FROM organization_members
    WHERE user_id = auth.uid()
  )
);
```

Se `03-SQL-MIGRASJONER.md` for komplett RLS-oppsett.

---

## Mapping til RF-1086

| RF-1086 Post | Beskrivelse | Datakilde |
|--------------|-------------|-----------|
| 1-2 | Aksjekapital inn/ut | companies + transactions |
| 3 | Pålydende | companies.par_value |
| 4 | Antall aksjer | companies.total_shares |
| 5 | Innbetalt aksjekapital | companies.paid_in_capital |
| 6 | Innbetalt overkurs | companies.paid_in_premium |
| 8 | Utdelt utbytte | transactions WHERE type='dividend' |
| 9-10 | Nyutstedte aksjer | transactions WHERE type IN ('founding', 'issue') |
| 11-12 | Slettede aksjer | transactions WHERE type='capital_reduction' |
| 19 | Aksjonærinfo | shareholders |
| 20 | Antall aksjer per aksjonær | shareholdings |
| 21 | Utbytte per aksjonær | transaction_lines WHERE type='dividend' |
| 23-24 | Aksjer i tilgang | transaction_lines WHERE direction='in' |
| 25-26 | Aksjer i avgang | transaction_lines WHERE direction='out' |
