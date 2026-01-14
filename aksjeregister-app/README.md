# Aksjeregister

Et webbasert aksjeregistersystem for håndtering av aksjeeierbøker, transaksjoner og RF-1086 rapportering.

## Funksjoner

- **Selskapsadministrasjon** - Opprett og vedlikehold aksjeselskaper
- **Aksjonærregister** - Administrer personer og selskaper som aksjonærer
- **Transaksjoner** - Stiftelse, salg/overføring, emisjon, utbytte
- **Aksjenummersporing** - Full oversikt over hvem som eier hvilke aksjenumre
- **Multi-tenancy** - Regnskapsførere kan administrere flere kunder
- **RF-1086 grunnlag** - Generer data for aksjonærregisteroppgaven

## Teknologi

- **Frontend:** React 18, Refine.dev, Ant Design
- **Backend:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth
- **Hosting:** Vercel (frontend), Supabase (backend)

## Kom i gang

### 1. Opprett Supabase-prosjekt

1. Gå til [supabase.com](https://supabase.com) og opprett en konto
2. Opprett et nytt prosjekt (velg EU-region for GDPR)
3. Noter ned `Project URL` og `anon public` key fra Settings → API

### 2. Kjør database-migrasjoner

I Supabase Dashboard, gå til SQL Editor og kjør migrasjonene i rekkefølge:

```
supabase/migrations/001_enums_extensions.sql
supabase/migrations/002_organizations_users.sql
supabase/migrations/003_companies_shareclasses.sql
supabase/migrations/004_shareholders.sql
supabase/migrations/005_shareholdings.sql
supabase/migrations/006_transactions.sql
supabase/migrations/007_documents.sql
supabase/migrations/008_triggers.sql
supabase/migrations/009_rls.sql
```

### 3. Konfigurer miljøvariabler

Kopier `.env.example` til `.env.local` og fyll inn verdiene:

```bash
cp .env.example .env.local
```

Rediger `.env.local`:

```env
VITE_SUPABASE_URL=https://ditt-prosjekt.supabase.co
VITE_SUPABASE_ANON_KEY=din-anon-key
```

### 4. Installer avhengigheter og start

```bash
npm install
npm run dev
```

Åpne [http://localhost:5173](http://localhost:5173)

## Prosjektstruktur

```
app/
├── src/
│   ├── components/       # Gjenbrukbare komponenter
│   │   └── layout/       # Header, sidebar
│   ├── pages/            # Sider
│   │   ├── companies/    # Selskaper CRUD
│   │   ├── shareholders/ # Aksjonærer CRUD
│   │   └── transactions/ # Transaksjoner CRUD
│   ├── providers/        # Auth provider
│   ├── types/            # TypeScript typer
│   ├── App.tsx           # Hovedapp med routing
│   └── supabaseClient.ts # Supabase-konfigurasjon
├── supabase/
│   └── migrations/       # SQL-migrasjoner
└── .env.example          # Eksempel miljøvariabler
```

## Første innlogging

1. Registrer en ny bruker via registreringsskjemaet
2. Bekreft e-postadressen (sjekk spam-mappen)
3. Logg inn
4. Opprett en organisasjon og ditt første selskap

## Dokumentasjon

Se dokumentasjonsmappen i rotprosjektet:

- `01-OVERSIKT.md` - Prosjektoversikt
- `02-DATAMODELL.md` - Database-skjema
- `03-SQL-MIGRASJONER.md` - Komplett SQL-referanse
- `04-BRUKERHISTORIER.md` - User stories
- `05-TRANSAKSJONSFLYT.md` - Detaljert transaksjonslogikk
- `06-ARKITEKTUR.md` - Teknisk arkitektur

## Utvikling

```bash
# Start utviklingsserver
npm run dev

# Bygg for produksjon
npm run build

# Forhåndsvis produksjonsbygg
npm run preview
```

## Deploy til Vercel

1. Push koden til GitHub
2. Koble Vercel til repositoryet
3. Sett miljøvariabler i Vercel Dashboard
4. Deploy!

## Lisens

Privat - Alle rettigheter forbeholdt.
