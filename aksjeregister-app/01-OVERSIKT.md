# Aksjeregistersystem - Prosjektspesifikasjon

## Versjon
- **Versjon:** 1.0
- **Dato:** Januar 2025
- **Status:** MVP-spesifikasjon

---

## Prosjektmål

Bygge et webbasert aksjeregistersystem som:

1. Håndterer aksjeeierbøker for flere selskaper
2. Støtter multi-tenancy med kundetilgang
3. Sporer alle transaksjoner med full historikk
4. Håndterer aksjenummerserier med avstemming
5. Genererer rapporter for RF-1086 aksjonærregisteroppgaven
6. Lagrer dokumentasjon (bilag) per transaksjon

---

## Målgruppe

- Regnskapsførere som administrerer flere selskaper
- Bedrifter som vil ha kontroll på egen aksjeeierbok
- Styreledere/daglige ledere med innsyn

---

## MVP-scope

### Inkludert i MVP

| Funksjon | Beskrivelse |
|----------|-------------|
| Brukeradministrasjon | Innlogging, roller, multi-tenancy |
| Selskapsadministrasjon | Opprette og vedlikeholde selskaper |
| Aksjonærregister | Personer og selskaper som aksjonærer |
| Stiftelse | Registrere nytt selskap med stiftere |
| Salg/overføring | Overføre aksjer mellom aksjonærer |
| Emisjon | Kapitalforhøyelse med nye aksjer |
| Utbytte | Registrere utbytteutdeling |
| Aksjenummersporing | Hvem eier hvilke aksjenumre |
| Dokumenthåndtering | Laste opp bilag per transaksjon |
| RF-1086 rapport | Generere grunnlag for aksjonærregisteroppgaven |

### Utenfor MVP (Fase 2+)

- Arv og gave
- Kapitalnedsettelse
- Splitt/spleis
- Fusjon/fisjon
- Direkte Altinn-integrasjon
- Tripletex-integrasjon
- BankID/ID-porten innlogging

---

## Teknologivalg

| Komponent | Teknologi | Begrunnelse |
|-----------|-----------|-------------|
| Database | Supabase (PostgreSQL) | Open source, gratis start, RLS for multi-tenancy |
| Auth | Supabase Auth | Integrert, støtter OAuth, kan utvides til BankID |
| Backend API | Supabase Auto-API | Automatisk REST/GraphQL fra skjema |
| Frontend | Refine.dev (React) | Open source admin-rammeverk, CRUD ut av boksen |
| Fillagring | Supabase Storage | Integrert, sikker, RLS-støtte |
| Hosting | Vercel (frontend) | Gratis tier, enkel deploy |

---

## Dokumentstruktur

```
aksjeregister-spec/
├── 01-OVERSIKT.md          # Dette dokumentet
├── 02-DATAMODELL.md        # Database-skjema og relasjoner
├── 03-SQL-MIGRASJONER.md   # SQL-skript for Supabase
├── 04-BRUKERHISTORIER.md   # User stories for MVP
├── 05-TRANSAKSJONSFLYT.md  # Detaljert flyt per transaksjonstype
└── 06-ARKITEKTUR.md        # Teknisk arkitektur
```

---

## Neste steg

1. Les gjennom spesifikasjonen
2. Opprett Supabase-prosjekt (gratis)
3. Kjør SQL-migrasjoner
4. Sett opp Refine.dev frontend
5. Implementer stiftelse først, deretter de andre transaksjonene
