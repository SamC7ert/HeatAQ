# Teknisk arkitektur - Aksjeregistersystem

## Oversikt

```
┌─────────────────────────────────────────────────────────────────┐
│                         Brukere                                  │
│                    (Nettleser / Mobil)                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (Vercel)                            │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │  Refine.dev │  │    React    │  │   Ant Design / MUI      │ │
│  │  (Admin UI) │  │             │  │   (Komponenter)         │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend (Supabase)                           │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │    Auth     │  │  Database   │  │       Storage           │ │
│  │ (Supabase   │  │ (PostgreSQL)│  │   (Dokumenter/bilag)    │ │
│  │   Auth)     │  │             │  │                         │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐                              │
│  │  REST API   │  │    RLS      │                              │
│  │ (Auto-gen)  │  │ (Security)  │                              │
│  └─────────────┘  └─────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Teknologivalg

### Frontend

| Komponent | Teknologi | Versjon | Begrunnelse |
|-----------|-----------|---------|-------------|
| Rammeverk | React | 18.x | Industristandard, stort økosystem |
| Admin UI | Refine.dev | 4.x | CRUD ut av boksen, Supabase-støtte |
| UI-komponenter | Ant Design | 5.x | Refine default, profesjonelt utseende |
| Routing | React Router | 6.x | Inkludert i Refine |
| State | React Query | 4.x | Inkludert i Refine |
| Skjemaer | React Hook Form | 7.x | Inkludert i Refine |
| Hosting | Vercel | - | Gratis tier, enkel deploy |

### Backend

| Komponent | Teknologi | Begrunnelse |
|-----------|-----------|-------------|
| Database | Supabase (PostgreSQL 15) | Open source, gratis start, RLS |
| Auth | Supabase Auth | Integrert, OAuth-støtte |
| API | Supabase Auto-API | REST automatisk fra skjema |
| Fillagring | Supabase Storage | Integrert, RLS-sikret |
| Sanntid | Supabase Realtime | Valgfritt, for live oppdateringer |

---

## Mappestruktur (Frontend)

```
aksjeregister-app/
├── public/
│   └── favicon.ico
├── src/
│   ├── components/           # Gjenbrukbare komponenter
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── Layout.tsx
│   │   ├── shareholders/
│   │   │   ├── ShareholderForm.tsx
│   │   │   └── ShareholderSelect.tsx
│   │   ├── transactions/
│   │   │   ├── FoundingForm.tsx
│   │   │   ├── TransferForm.tsx
│   │   │   ├── IssueForm.tsx
│   │   │   └── DividendForm.tsx
│   │   └── documents/
│   │       ├── DocumentUpload.tsx
│   │       └── DocumentList.tsx
│   │
│   ├── pages/                # Sider (Refine resources)
│   │   ├── companies/
│   │   │   ├── list.tsx
│   │   │   ├── show.tsx
│   │   │   ├── create.tsx
│   │   │   └── edit.tsx
│   │   ├── shareholders/
│   │   │   ├── list.tsx
│   │   │   ├── show.tsx
│   │   │   └── create.tsx
│   │   ├── transactions/
│   │   │   ├── list.tsx
│   │   │   ├── show.tsx
│   │   │   └── create.tsx
│   │   └── reports/
│   │       ├── shareholder-book.tsx
│   │       └── rf1086.tsx
│   │
│   ├── providers/            # Kontekst og providers
│   │   ├── AuthProvider.tsx
│   │   └── OrganizationProvider.tsx
│   │
│   ├── hooks/                # Custom hooks
│   │   ├── useOrganization.ts
│   │   ├── useCompany.ts
│   │   └── useShareNumbers.ts
│   │
│   ├── utils/                # Hjelpefunksjoner
│   │   ├── calculations.ts   # Beregninger
│   │   ├── validation.ts     # Valideringsregler
│   │   └── formatting.ts     # Formatering
│   │
│   ├── types/                # TypeScript typer
│   │   ├── database.ts       # Supabase-genererte typer
│   │   └── forms.ts          # Skjematyper
│   │
│   ├── App.tsx               # Hovedapp med Refine
│   ├── index.tsx             # Entry point
│   └── supabaseClient.ts     # Supabase-konfig
│
├── package.json
├── tsconfig.json
├── .env.local                # Miljøvariabler
└── README.md
```

---

## Supabase-oppsett

### 1. Opprett prosjekt

1. Gå til https://supabase.com
2. Opprett ny konto (gratis)
3. Opprett nytt prosjekt
4. Velg region (EU - Frankfurt anbefalt for GDPR)
5. Lagre database-passordet sikkert

### 2. Kjør migrasjoner

1. Gå til SQL Editor i Supabase Dashboard
2. Kjør migrasjonene fra `03-SQL-MIGRASJONER.md` i rekkefølge
3. Verifiser at tabeller er opprettet

### 3. Konfigurer Storage

```sql
-- Opprett bucket for dokumenter
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false);

-- RLS policy for documents bucket
CREATE POLICY "Users can upload documents to their organizations"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] IN (
    SELECT c.id::text FROM companies c
    WHERE c.organization_id IN (SELECT get_user_organizations())
  )
);

CREATE POLICY "Users can view documents in their organizations"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] IN (
    SELECT c.id::text FROM companies c
    WHERE c.organization_id IN (SELECT get_user_organizations())
  )
);
```

### 4. Miljøvariabler

```env
# .env.local
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Refine-konfigurasjon

### App.tsx

```tsx
import { Refine } from "@refinedev/core";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";
import { notificationProvider, Layout } from "@refinedev/antd";
import { dataProvider, liveProvider } from "@refinedev/supabase";
import routerBindings from "@refinedev/react-router-v6";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { BankOutlined, UserOutlined, SwapOutlined } from "@ant-design/icons";

import { supabaseClient } from "./supabaseClient";
import { authProvider } from "./authProvider";

import { CompanyList, CompanyCreate, CompanyShow } from "./pages/companies";
import { ShareholderList, ShareholderCreate } from "./pages/shareholders";
import { TransactionList, TransactionCreate, TransactionShow } from "./pages/transactions";

function App() {
  return (
    <BrowserRouter>
      <RefineKbarProvider>
        <Refine
          dataProvider={dataProvider(supabaseClient)}
          liveProvider={liveProvider(supabaseClient)}
          authProvider={authProvider}
          routerProvider={routerBindings}
          notificationProvider={notificationProvider}
          resources={[
            {
              name: "companies",
              list: "/companies",
              create: "/companies/create",
              show: "/companies/show/:id",
              meta: { label: "Selskaper", icon: <BankOutlined /> },
            },
            {
              name: "shareholders",
              list: "/shareholders",
              create: "/shareholders/create",
              meta: { label: "Aksjonærer", icon: <UserOutlined /> },
            },
            {
              name: "transactions",
              list: "/transactions",
              create: "/transactions/create",
              show: "/transactions/show/:id",
              meta: { label: "Transaksjoner", icon: <SwapOutlined /> },
            },
          ]}
        >
          <Layout>
            <Routes>
              <Route path="/companies" element={<CompanyList />} />
              <Route path="/companies/create" element={<CompanyCreate />} />
              <Route path="/companies/show/:id" element={<CompanyShow />} />
              {/* ... flere routes */}
            </Routes>
          </Layout>
          <RefineKbar />
        </Refine>
      </RefineKbarProvider>
    </BrowserRouter>
  );
}

export default App;
```

### supabaseClient.ts

```typescript
import { createClient } from "@supabase/supabase-js";
import { Database } from "./types/database";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseClient = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey
);
```

---

## Autentiseringsflyt

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Bruker    │────▶│  Supabase   │────▶│  Database   │
│  (Login)    │     │    Auth     │     │   (users)   │
└─────────────┘     └─────────────┘     └─────────────┘
                          │
                          ▼
                    ┌─────────────┐
                    │   Trigger   │
                    │ (on signup) │
                    └─────────────┘
                          │
                          ▼
                    ┌─────────────┐
                    │   users     │
                    │   (profil)  │
                    └─────────────┘
```

### authProvider.ts

```typescript
import { AuthBindings } from "@refinedev/core";
import { supabaseClient } from "./supabaseClient";

export const authProvider: AuthBindings = {
  login: async ({ email, password }) => {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { success: false, error };
    }

    return { success: true, redirectTo: "/" };
  },

  logout: async () => {
    const { error } = await supabaseClient.auth.signOut();
    return { success: !error, redirectTo: "/login" };
  },

  check: async () => {
    const { data } = await supabaseClient.auth.getSession();
    return { authenticated: !!data.session };
  },

  getIdentity: async () => {
    const { data } = await supabaseClient.auth.getUser();
    if (data?.user) {
      return {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata?.full_name,
      };
    }
    return null;
  },

  register: async ({ email, password, fullName }) => {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });

    if (error) {
      return { success: false, error };
    }

    return { success: true };
  },
};
```

---

## Dataflyt for transaksjoner

```
┌─────────────────┐
│  Bruker fyller  │
│  ut skjema      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Validering     │
│  (frontend)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  API-kall til   │
│  Supabase       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Database       │
│  Transaction    │
│  (atomisk)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  RLS sjekker    │
│  tilgang        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Respons til    │
│  frontend       │
└─────────────────┘
```

---

## Sikkerhet

### Row Level Security (RLS)

All datatilgang kontrolleres av PostgreSQL RLS:

```
Bruker → Supabase Auth → JWT token → RLS policies → Data
```

- Brukeren ser kun data fra sine organisasjoner
- Policies definert per tabell
- Kan ikke omgås fra frontend

### Autentisering

- Supabase Auth håndterer innlogging
- JWT-tokens med kort levetid
- Refresh tokens for sesjonsfornyelse
- Støtte for OAuth (Google, etc.) kan legges til senere

### Filsikkerhet

- Dokumenter lagres i Supabase Storage
- Egen RLS på storage buckets
- Filer organisert per selskap: `documents/{company_id}/{filename}`

---

## Deployment

### Frontend (Vercel)

1. Push kode til GitHub
2. Koble Vercel til GitHub-repo
3. Sett miljøvariabler i Vercel
4. Automatisk deploy ved push til main

```bash
# Lokal utvikling
npm install
npm run dev

# Bygg for produksjon
npm run build
```

### Backend (Supabase)

- Hostes av Supabase (managed)
- Migrasjoner kjøres manuelt i SQL Editor
- Eller bruk Supabase CLI for versjonskontroll:

```bash
# Installer Supabase CLI
npm install -g supabase

# Initialiser
supabase init

# Koble til prosjekt
supabase link --project-ref your-project-ref

# Push migrasjoner
supabase db push
```

---

## Ytelse

### Database-indekser

Kritiske indekser er definert i migrasjonen:
- `companies(organization_id)` - filtrering per tenant
- `transactions(company_id, transaction_date)` - historikkspørringer
- `share_number_ranges(company_id, range_start, range_end)` - aksjenummeroppslag

### Caching

- React Query (inkludert i Refine) cacher API-responser
- Supabase har innebygd connection pooling
- Vurder edge caching for statiske ressurser

### Optimalisering

- Lazy loading av sider
- Paginering på lister
- Debounce på søkefelt

---

## Monitorering

### Supabase Dashboard

- Database-ytelse og spørringer
- Auth-statistikk
- Storage-bruk
- API-kall

### Frontend

- Vercel Analytics (gratis tier)
- Console errors i produksjon

### Fremtidig (Fase 2+)

- Sentry for feilsporing
- Datadog eller lignende for full observability

---

## Skalering

### Supabase Free → Pro

| Metrikk | Free | Pro |
|---------|------|-----|
| Database | 500 MB | 8 GB |
| Storage | 1 GB | 100 GB |
| Båndbredde | 2 GB | 250 GB |
| Brukere | 50 000 | 100 000 |

### Når oppgradere?

- Databasestørrelse nærmer seg 500 MB
- Mange samtidige brukere
- Behov for daglige backups
- Behov for point-in-time recovery

### Selvhosting (valgfritt)

Supabase er open source. Ved behov kan hele stacken selvhostes:
- Docker Compose for lokal/test
- Kubernetes for produksjon
- Krever mer DevOps-kompetanse

---

## Neste steg for implementasjon

### 1. Sett opp Supabase (30 min)
- Opprett konto og prosjekt
- Kjør SQL-migrasjoner
- Verifiser tabeller og RLS

### 2. Scaffold frontend (1 time)
```bash
npm create refine-app@latest aksjeregister-app -- \
  --preset refine-supabase \
  --ui antd
```

### 3. Implementer autentisering (2 timer)
- Login/register sider
- AuthProvider
- Organisasjonsopprettelse for nye brukere

### 4. Bygg CRUD for grunndata (4 timer)
- Selskaper (list, create, show)
- Aksjonærer (list, create)
- Aksjeklasser

### 5. Implementer stiftelse (4 timer)
- Transaksjonsform
- Aksjenummertildeling
- Dokumentopplasting

### 6. Implementer salg (4 timer)
- Velg selger/kjøper
- Aksjenummerhåndtering
- Validering

### 7. Implementer emisjon og utbytte (4 timer)
- Emisjonsberegninger
- Utbyttefordeling

### 8. Rapporter (4 timer)
- Aksjeeierbok
- RF-1086 grunnlag

**Estimert total tid: ~25 timer**
