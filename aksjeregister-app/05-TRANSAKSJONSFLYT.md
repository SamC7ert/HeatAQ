# Transaksjonsflyt - Detaljert beskrivelse

## Prinsipper

1. **Dobbel bokføring:** Hver transaksjon har linjer med retning (in/out) som balanserer
2. **Aksjenummersporing:** Alle aksjer har unike numre som spores gjennom transaksjoner
3. **Dokumentasjon:** Hver transaksjon har tilhørende bilag
4. **Avstemming:** Sum aksjer per aksjonær = Totalt antall aksjer i selskapet

---

## 1. Stiftelse

### Scenario
Aquarious AS stiftes med aksjekapital NOK 100 530, fordelt på 3 351 aksjer à NOK 30.

Fire stiftere:
- Csub AS: 1 151 aksjer
- COD AS: 1 012 aksjer
- Meyer Norschau Design AS: 288 aksjer
- 7ertsen AS: 900 aksjer

### Dataflyt

```
INNDATA:
├── Selskap (allerede opprettet)
│   ├── share_capital: 100530
│   ├── total_shares: 3351
│   └── par_value: 30
│
├── Stiftere
│   ├── Csub AS: 1151 aksjer, innbetalt 34530 NOK
│   ├── COD AS: 1012 aksjer, innbetalt 30360 NOK
│   ├── Meyer Norschau Design AS: 288 aksjer, innbetalt 8640 NOK
│   └── 7ertsen AS: 900 aksjer, innbetalt 27000 NOK
│
└── Dokumenter
    ├── Stiftelsesdokument (påkrevd)
    └── Vedtekter

UTDATA (database):
├── transactions
│   ├── type: 'founding'
│   ├── transaction_date: 2023-12-22
│   ├── shares_before: 0
│   ├── shares_after: 3351
│   ├── capital_before: 0
│   └── capital_after: 100530
│
├── transaction_lines (4 stk, alle direction='in')
│   ├── Csub AS: 1151 aksjer
│   ├── COD AS: 1012 aksjer
│   ├── Meyer Norschau: 288 aksjer
│   └── 7ertsen AS: 900 aksjer
│
├── shareholdings (4 stk)
│   ├── Csub AS: 1151 (34.35%)
│   ├── COD AS: 1012 (30.20%)
│   ├── Meyer Norschau: 288 (8.59%)
│   └── 7ertsen AS: 900 (26.86%)
│
├── share_number_ranges (4 stk)
│   ├── Csub AS: 1-1151
│   ├── COD AS: 1152-2163
│   ├── Meyer Norschau: 2164-2451
│   └── 7ertsen AS: 2452-3351
│
└── documents
    ├── Stiftelsesdokument
    └── Vedtekter
```

### Valideringer
- [ ] Sum aksjer til stiftere = total_shares
- [ ] Sum innbetalt = share_capital (eller mer ved overkurs)
- [ ] Alle stiftere har gyldig identifikasjon

### Aksjenummertildeling
Automatisk sekvensiell tildeling:
1. Sorter stiftere (f.eks. alfabetisk eller etter input-rekkefølge)
2. Tildel numre fortløpende: 1-N for første, N+1 til M for neste, osv.

---

## 2. Salg/overføring

### Scenario
7ertsen AS selger 50 aksjer til Meyer Norschau Design AS for 1 kr per aksje.

### Før transaksjon
```
7ertsen AS: 900 aksjer (2452-3351)
Meyer Norschau: 288 aksjer (2164-2451)
```

### Etter transaksjon
```
7ertsen AS: 850 aksjer (2502-3351)
Meyer Norschau: 338 aksjer (2164-2451, 2452-2501)
```

### Dataflyt

```
INNDATA:
├── Selger: 7ertsen AS
├── Kjøper: Meyer Norschau Design AS
├── Antall: 50 aksjer
├── Aksjenumre: 2452-2501 (velges fra selgers beholdning)
├── Pris per aksje: 1 NOK
├── Totalpris: 50 NOK
├── Transaksjonsdato: 2024-09-04
│
└── Dokumenter
    └── Kjøpsavtale

UTDATA (database):
├── transactions
│   ├── type: 'transfer'
│   ├── transaction_date: 2024-09-04
│   ├── shares_before: 3351
│   ├── shares_after: 3351 (uendret)
│   ├── capital_before: 100530
│   ├── capital_after: 100530 (uendret)
│   ├── price_per_share: 1
│   └── total_amount: 50
│
├── transaction_lines (2 stk)
│   ├── 7ertsen AS: direction='out', 50 aksjer, "2452-2501"
│   └── Meyer Norschau: direction='in', 50 aksjer, "2452-2501"
│
├── shareholdings (oppdatert)
│   ├── 7ertsen AS: 850 (25.37%)
│   └── Meyer Norschau: 338 (10.09%)
│
├── share_number_ranges
│   ├── 7ertsen AS (2452-3351): is_active=FALSE, disposed_transaction_id=X
│   ├── 7ertsen AS (2502-3351): is_active=TRUE (NY - rest etter salg)
│   └── Meyer Norschau (2452-2501): is_active=TRUE (NY - kjøpte aksjer)
│
└── documents
    └── Kjøpsavtale
```

### Logikk for aksjenummerhåndtering

```python
# Pseudokode for splitting av aksjenummerserier

def sell_shares(seller_id, buyer_id, share_numbers_to_sell, transaction_id):
    # 1. Finn selgers aktive serier
    seller_ranges = get_active_ranges(seller_id)

    # 2. For hver serie som overlapper med solgte numre
    for range in seller_ranges:
        overlap = calculate_overlap(range, share_numbers_to_sell)

        if overlap:
            # Deaktiver gammel serie
            range.is_active = False
            range.disposed_transaction_id = transaction_id

            # Opprett nye serier for det som er igjen
            remaining = subtract_ranges(range, overlap)
            for r in remaining:
                create_range(seller_id, r.start, r.end, is_active=True)

            # Opprett serie for kjøper
            create_range(buyer_id, overlap.start, overlap.end,
                        acquired_transaction_id=transaction_id)
```

### Valideringer
- [ ] Selger eier de angitte aksjenumrene
- [ ] Antall aksjer matcher aksjenummerserien
- [ ] Kjøper er gyldig aksjonær (eller opprettes)

---

## 3. Emisjon

### Scenario
Aquarious AS gjennomfører emisjon:
- 468 nye aksjer
- Emisjonskurs: 3000 NOK per aksje
- Overkurs: 2970 NOK per aksje (3000 - 30 pålydende)

Tegnere:
- Husk Safety AS (ny aksjonær): 100 aksjer = 300 000 NOK
- Meyer Norschau Design AS: 34 aksjer = 102 000 NOK
- 7ertsen AS: 334 aksjer = 1 002 000 NOK

### Før transaksjon
```
Aksjekapital: 100 530 NOK
Antall aksjer: 3 351
```

### Etter transaksjon
```
Aksjekapital: 114 570 NOK (+14 040 = 468 × 30)
Antall aksjer: 3 819 (+468)
Overkurs: 1 389 960 NOK (468 × 2970)
```

### Dataflyt

```
INNDATA:
├── Emisjonsparametre
│   ├── Antall nye aksjer: 468
│   ├── Emisjonskurs: 3000 NOK
│   ├── Beslutningsdato: 2025-07-01
│   └── Registreringsdato: 2025-07-14
│
├── Tegnere
│   ├── Husk Safety AS: 100 aksjer, 300000 NOK
│   ├── Meyer Norschau: 34 aksjer, 102000 NOK
│   └── 7ertsen AS: 334 aksjer, 1002000 NOK
│
└── Dokumenter
    ├── Generalforsamlingsprotokoll (påkrevd)
    └── Tegningsblanketter

UTDATA (database):
├── companies (oppdatert)
│   ├── share_capital: 114570
│   ├── total_shares: 3819
│   ├── paid_in_capital: 114570
│   └── paid_in_premium: 1389960
│
├── transactions
│   ├── type: 'issue'
│   ├── transaction_date: 2025-07-14
│   ├── decision_date: 2025-07-01
│   ├── shares_before: 3351
│   ├── shares_after: 3819
│   ├── capital_before: 100530
│   ├── capital_after: 114570
│   ├── price_per_share: 3000
│   └── total_amount: 1404000
│
├── transaction_lines (3 stk, alle direction='in')
│   ├── Husk Safety AS: 100 aksjer, 300000 NOK
│   ├── Meyer Norschau: 34 aksjer, 102000 NOK
│   └── 7ertsen AS: 334 aksjer, 1002000 NOK
│
├── shareholdings
│   ├── Husk Safety AS: 100 (2.62%) - NY
│   ├── Meyer Norschau: 372 (9.74%) - oppdatert fra 338
│   └── 7ertsen AS: 1184 (31.00%) - oppdatert fra 850
│
├── share_number_ranges (nye)
│   ├── Husk Safety AS: 3352-3451
│   ├── Meyer Norschau: 3452-3485
│   └── 7ertsen AS: 3486-3819
│
└── documents
    ├── Generalforsamlingsprotokoll
    └── Tegningsblanketter
```

### Beregninger
```
Ny aksjekapital = gammel + (nye aksjer × pålydende)
                = 100530 + (468 × 30)
                = 114570

Overkurs per aksje = emisjonskurs - pålydende
                   = 3000 - 30
                   = 2970

Total overkurs = nye aksjer × overkurs per aksje
               = 468 × 2970
               = 1389960
```

### Valideringer
- [ ] Sum aksjer til tegnere = antall nye aksjer
- [ ] Sum innbetalt = totalt emisjonsbeløp
- [ ] Emisjonskurs >= pålydende

---

## 4. Utbytte

### Scenario
Aquarious AS utdeler utbytte: 10 NOK per aksje.

### Beholdning på vedtakstidspunktet
```
Csub AS: 1151 aksjer → 11 510 NOK
COD AS: 1012 aksjer → 10 120 NOK
Husk Safety AS: 100 aksjer → 1 000 NOK
Meyer Norschau Design AS: 372 aksjer → 3 720 NOK
7ertsen AS: 1184 aksjer → 11 840 NOK
---
Totalt: 3819 aksjer → 38 190 NOK
```

### Dataflyt

```
INNDATA:
├── Utbytteparametre
│   ├── Utbytte per aksje: 10 NOK
│   ├── Vedtaksdato: 2025-05-15
│   └── Utbetalingsdato: 2025-05-30
│
└── Dokumenter
    └── Generalforsamlingsprotokoll

UTDATA (database):
├── transactions
│   ├── type: 'dividend'
│   ├── transaction_date: 2025-05-15
│   ├── decision_date: 2025-05-15
│   ├── dividend_per_share: 10
│   ├── total_amount: 38190
│   ├── shares_before: 3819
│   ├── shares_after: 3819 (uendret)
│   ├── capital_before: 114570
│   └── capital_after: 114570 (uendret)
│
├── transaction_lines (5 stk, ingen direction - utbytte er annerledes)
│   ├── Csub AS: 1151 aksjer, amount=11510
│   ├── COD AS: 1012 aksjer, amount=10120
│   ├── Husk Safety AS: 100 aksjer, amount=1000
│   ├── Meyer Norschau: 372 aksjer, amount=3720
│   └── 7ertsen AS: 1184 aksjer, amount=11840
│
└── documents
    └── Generalforsamlingsprotokoll
```

### Kildeskatt (for utenlandske aksjonærer)

Hvis f.eks. Husk Safety AS var utenlandsk:
```
transaction_lines for Husk Safety AS:
├── num_shares: 100
├── amount: 1000 (brutto)
├── withholding_tax_rate: 25.0
├── withholding_tax_amount: 250
└── net_amount: 750
```

### Valideringer
- [ ] Utbytte per aksje × totale aksjer = total utbytteutdeling
- [ ] Selskapet har tilstrekkelig fri egenkapital (ikke validert i MVP)

---

## Avstemming

### Kontroller som bør kjøres

```sql
-- 1. Sum shareholdings = company.total_shares
SELECT c.id, c.name, c.total_shares,
       COALESCE(SUM(sh.num_shares), 0) as sum_shareholdings
FROM companies c
LEFT JOIN shareholdings sh ON c.id = sh.company_id
GROUP BY c.id
HAVING c.total_shares != COALESCE(SUM(sh.num_shares), 0);

-- 2. Sum aktive aksjenummerserier = company.total_shares
SELECT c.id, c.name, c.total_shares,
       COALESCE(SUM(snr.range_end - snr.range_start + 1), 0) as sum_ranges
FROM companies c
LEFT JOIN share_number_ranges snr ON c.id = snr.company_id AND snr.is_active = TRUE
GROUP BY c.id
HAVING c.total_shares != COALESCE(SUM(snr.range_end - snr.range_start + 1), 0);

-- 3. Ingen overlappende aktive aksjenummerserier
SELECT a.id, b.id, a.range_start, a.range_end, b.range_start, b.range_end
FROM share_number_ranges a
JOIN share_number_ranges b ON a.company_id = b.company_id
  AND a.id < b.id
  AND a.is_active = TRUE
  AND b.is_active = TRUE
WHERE a.range_start <= b.range_end AND b.range_start <= a.range_end;

-- 4. Shareholding.num_shares = sum av aktive ranges for aksjonær
SELECT sh.id, sh.num_shares,
       COALESCE(SUM(snr.range_end - snr.range_start + 1), 0) as sum_ranges
FROM shareholdings sh
LEFT JOIN share_number_ranges snr ON sh.company_id = snr.company_id
  AND sh.shareholder_id = snr.shareholder_id
  AND snr.is_active = TRUE
GROUP BY sh.id
HAVING sh.num_shares != COALESCE(SUM(snr.range_end - snr.range_start + 1), 0);
```

---

## Feilhåndtering

### Vanlige feilsituasjoner

| Feil | Håndtering |
|------|------------|
| Selger har ikke nok aksjer | Avvis transaksjon, vis beholdning |
| Aksjenumre finnes ikke | Avvis, vis gyldige numre |
| Sum aksjer != totalt | Valideringsfeil før lagring |
| Duplikate aksjenumre | Databaseconstraint + applikasjonsvalidering |
| Manglende påkrevd dokument | Advarsel, men tillat lagring som utkast |

### Transaksjoner og atomisitet

Alle databaseoperasjoner for én transaksjon må være atomiske:

```sql
BEGIN;
  INSERT INTO transactions (...) VALUES (...);
  INSERT INTO transaction_lines (...) VALUES (...);
  UPDATE shareholdings SET ...;
  UPDATE share_number_ranges SET is_active = FALSE WHERE ...;
  INSERT INTO share_number_ranges (...) VALUES (...);
  UPDATE companies SET share_capital = ..., total_shares = ... WHERE ...;
COMMIT;
```

Ved feil: `ROLLBACK` hele transaksjonen.
