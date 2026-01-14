# Brukerhistorier - MVP

## Oversikt

Brukerhistoriene er organisert etter funksjonelle områder og prioritert for MVP.

---

## Autentisering og tilgang

### US-001: Registrering
**Som** ny bruker
**Vil jeg** kunne registrere meg med e-post og passord
**Slik at** jeg får tilgang til systemet

**Akseptansekriterier:**
- [ ] Registreringsskjema med e-post, passord, navn
- [ ] E-postbekreftelse sendes
- [ ] Brukerprofil opprettes automatisk
- [ ] Feilmelding ved ugyldig e-post eller svakt passord

---

### US-002: Innlogging
**Som** registrert bruker
**Vil jeg** kunne logge inn med e-post og passord
**Slik at** jeg får tilgang til mine selskaper

**Akseptansekriterier:**
- [ ] Innloggingsskjema
- [ ] "Glemt passord" funksjonalitet
- [ ] Omdirigering til dashboard etter innlogging
- [ ] Feilmelding ved feil legitimasjon

---

### US-003: Organisasjonsopprettelse
**Som** ny bruker uten organisasjonstilknytning
**Vil jeg** kunne opprette en ny organisasjon
**Slik at** jeg kan begynne å administrere selskaper

**Akseptansekriterier:**
- [ ] Skjema for organisasjonsnavn og evt. org.nr.
- [ ] Bruker blir automatisk admin i organisasjonen
- [ ] Omdirigering til dashboard

---

### US-004: Invitere bruker
**Som** admin i en organisasjon
**Vil jeg** kunne invitere nye brukere
**Slik at** kolleger kan få tilgang

**Akseptansekriterier:**
- [ ] Invitasjonsskjema med e-post og rolle
- [ ] E-postinvitasjon sendes
- [ ] Invitert bruker kan registrere seg og kobles til organisasjonen
- [ ] Roller: admin, editor, viewer

---

## Selskapsadministrasjon

### US-010: Liste selskaper
**Som** bruker
**Vil jeg** se en oversikt over alle selskaper i min organisasjon
**Slik at** jeg kan velge hvilket selskap jeg vil jobbe med

**Akseptansekriterier:**
- [ ] Tabell med selskapsnavn, org.nr., aksjekapital, antall aksjonærer
- [ ] Søk/filter funksjonalitet
- [ ] Klikk for å gå til selskapsdetaljer

---

### US-011: Opprett selskap
**Som** editor eller admin
**Vil jeg** kunne opprette et nytt selskap
**Slik at** jeg kan begynne å føre aksjeeierboken

**Akseptansekriterier:**
- [ ] Skjema med: navn, org.nr., adresse, stiftelsesdato
- [ ] Aksjekapital, antall aksjer, pålydende (med validering)
- [ ] Automatisk opprettelse av standard aksjeklasse ("Ordinære")
- [ ] Etter opprettelse: gå til stiftelsestransaksjon

---

### US-012: Rediger selskap
**Som** editor eller admin
**Vil jeg** kunne redigere selskapsopplysninger
**Slik at** informasjonen holdes oppdatert

**Akseptansekriterier:**
- [ ] Rediger navn, adresse, kontaktinfo
- [ ] Aksjekapital og antall aksjer er ikke direkte redigerbare (endres via transaksjoner)
- [ ] Logg over endringer

---

### US-013: Selskapsdetaljer
**Som** bruker
**Vil jeg** se detaljer om et selskap
**Slik at** jeg har oversikt over nåværende status

**Akseptansekriterier:**
- [ ] Viser: navn, org.nr., aksjekapital, antall aksjer, pålydende
- [ ] Liste over aksjonærer med beholdning og eierandel
- [ ] Knapper til: ny transaksjon, transaksjonshistorikk, dokumenter

---

## Aksjonæradministrasjon

### US-020: Liste aksjonærer
**Som** bruker
**Vil jeg** se alle aksjonærer i organisasjonen
**Slik at** jeg kan gjenbruke dem på tvers av selskaper

**Akseptansekriterier:**
- [ ] Tabell med navn, type (person/selskap), org.nr./fødselsdato
- [ ] Søk/filter
- [ ] Viser hvilke selskaper aksjonæren eier aksjer i

---

### US-021: Opprett aksjonær
**Som** editor eller admin
**Vil jeg** kunne registrere en ny aksjonær
**Slik at** de kan inkluderes i transaksjoner

**Akseptansekriterier:**
- [ ] Valg: person eller selskap
- [ ] Person: navn, fødselsdato, adresse, e-post
- [ ] Selskap: navn, org.nr., adresse, e-post
- [ ] Validering av org.nr. format

---

### US-022: Rediger aksjonær
**Som** editor eller admin
**Vil jeg** kunne oppdatere aksjonæropplysninger
**Slik at** kontaktinfo holdes oppdatert

**Akseptansekriterier:**
- [ ] Rediger alle felt unntatt type
- [ ] Historikk over endringer (for RF-1086)

---

## Transaksjoner - Stiftelse

### US-030: Registrer stiftelse
**Som** editor eller admin
**Vil jeg** kunne registrere stiftelsen av et selskap
**Slik at** grunnlaget for aksjeeierboken etableres

**Akseptansekriterier:**
- [ ] Automatisk trigger etter opprettelse av nytt selskap
- [ ] Stiftelsesdato (hentes fra selskap)
- [ ] Legg til stiftere (eksisterende eller nye aksjonærer)
- [ ] For hver stifter: antall aksjer, innbetalt beløp
- [ ] Automatisk tildeling av aksjenumre (1, 2, 3...)
- [ ] Validering: sum aksjer = totalt antall aksjer
- [ ] Last opp: stiftelsesdokument (påkrevd), vedtekter

**UI-flyt:**
1. Vis selskapsinformasjon (readonly)
2. Legg til stifter → modal for å velge/opprette aksjonær
3. Angi antall aksjer og beløp per stifter
4. Vis aksjenumre som tildeles
5. Last opp dokumenter
6. Bekreft og fullfør

---

## Transaksjoner - Salg/overføring

### US-040: Registrer salg
**Som** editor eller admin
**Vil jeg** kunne registrere salg av aksjer mellom aksjonærer
**Slik at** eierskiftet dokumenteres

**Akseptansekriterier:**
- [ ] Velg selskap (hvis ikke allerede valgt)
- [ ] Velg selger fra liste over aksjonærer med beholdning
- [ ] Vis selgers aksjer og aksjenumre
- [ ] Angi antall aksjer som selges
- [ ] Velg hvilke aksjenumre (auto-forslag: laveste først)
- [ ] Angi pris per aksje og totalpris
- [ ] Velg kjøper (eksisterende eller ny aksjonær)
- [ ] Transaksjonsdato
- [ ] Last opp: kjøpsavtale (påkrevd), styregodkjenning (valgfri)
- [ ] Validering: selger har nok aksjer

**UI-flyt:**
1. Velg selger → vis beholdning
2. Angi antall og pris
3. Velg aksjenumre (checkbox eller auto)
4. Velg/opprett kjøper
5. Last opp dokumenter
6. Forhåndsvisning av endring
7. Bekreft og fullfør

**Systemhandlinger:**
- Oppdater selgers shareholding (reduser)
- Oppdater kjøpers shareholding (øk eller opprett)
- Deaktiver selgers share_number_ranges
- Opprett nye share_number_ranges for kjøper
- Beregn eierandeler på nytt

---

## Transaksjoner - Emisjon

### US-050: Registrer emisjon
**Som** editor eller admin
**Vil jeg** kunne registrere en kapitalforhøyelse
**Slik at** nye aksjer utstedes korrekt

**Akseptansekriterier:**
- [ ] Velg selskap
- [ ] Angi emisjonsdetaljer:
  - Antall nye aksjer
  - Emisjonskurs (pris per aksje)
  - Beregn: overkurs = emisjonskurs - pålydende
  - Beregn: totalt emisjonsbeløp
- [ ] Fordel aksjer på tegnere:
  - For hver tegner: aksjonær + antall aksjer + beløp
  - Validering: sum = totalt antall nye aksjer
- [ ] Datoer: beslutningsdato, registreringsdato
- [ ] Last opp: generalforsamlingsprotokoll (påkrevd), tegningsblanketter
- [ ] Forhåndsvisning: ny aksjekapital, nye totaler

**UI-flyt:**
1. Angi emisjonsparametre
2. Legg til tegnere (ny knapp per tegner)
3. For hver tegner: velg aksjonær, angi aksjer
4. Vis beregnet beløp per tegner
5. Last opp dokumenter
6. Forhåndsvisning med før/etter sammenligning
7. Bekreft og fullfør

**Systemhandlinger:**
- Oppdater company: share_capital, total_shares, paid_in_capital, paid_in_premium
- Opprett/oppdater shareholdings for tegnere
- Opprett share_number_ranges (fra neste ledige nummer)
- Beregn eierandeler på nytt

---

## Transaksjoner - Utbytte

### US-060: Registrer utbytte
**Som** editor eller admin
**Vil jeg** kunne registrere utbytteutdeling
**Slik at** det dokumenteres for RF-1086

**Akseptansekriterier:**
- [ ] Velg selskap
- [ ] Angi utbytte per aksje ELLER totalt utbytte
- [ ] Automatisk beregning per aksjonær basert på beholdning
- [ ] For utenlandske aksjonærer: angi kildeskatt %
- [ ] Datoer: vedtaksdato, utbetalingsdato
- [ ] Last opp: generalforsamlingsprotokoll (påkrevd)
- [ ] Forhåndsvisning: tabell med alle aksjonærer og beløp

**UI-flyt:**
1. Angi utbytte per aksje
2. Se automatisk beregnet tabell
3. Juster kildeskatt for relevante aksjonærer
4. Angi datoer
5. Last opp dokumenter
6. Bekreft og fullfør

**Systemhandlinger:**
- Opprett transaction med type='dividend'
- Opprett transaction_lines for hver aksjonær
- Ingen endring i aksjekapital eller beholdninger

---

## Rapporter

### US-070: Aksjeeierbok (nåværende)
**Som** bruker
**Vil jeg** kunne generere en aksjeeierbok
**Slik at** jeg har oversikt over nåværende eierskap

**Akseptansekriterier:**
- [ ] Velg selskap og dato (default: i dag)
- [ ] Viser: selskapsinformasjon, aksjonærliste med beholdning og aksjenumre
- [ ] Eksporter til PDF eller Excel

---

### US-071: Transaksjonshistorikk
**Som** bruker
**Vil jeg** kunne se alle transaksjoner for et selskap
**Slik at** jeg kan spore historikken

**Akseptansekriterier:**
- [ ] Tabell med dato, type, beskrivelse, aksjer før/etter
- [ ] Filter på type og datoperiode
- [ ] Klikk for å se detaljer og dokumenter

---

### US-072: RF-1086 grunnlag
**Som** bruker
**Vil jeg** kunne generere grunnlag for aksjonærregisteroppgaven
**Slik at** jeg kan fylle ut skjemaet

**Akseptansekriterier:**
- [ ] Velg selskap og inntektsår
- [ ] Genererer rapport med:
  - Selskapsopplysninger (post 1-7)
  - Utbytte (post 8)
  - Kapitalendringer (post 9-18)
  - Per aksjonær: beholdning, transaksjoner (post 19-30)
- [ ] Eksporter til PDF

---

## Dokumenthåndtering

### US-080: Laste opp dokument
**Som** editor eller admin
**Vil jeg** kunne laste opp dokumenter til en transaksjon
**Slik at** dokumentasjonen er samlet

**Akseptansekriterier:**
- [ ] Drag-and-drop eller filvelger
- [ ] Støttede formater: PDF, Word, bilder
- [ ] Maks filstørrelse: 10 MB
- [ ] Velg dokumenttype fra liste
- [ ] Vis opplastede dokumenter med ikon og navn

---

### US-081: Se og laste ned dokumenter
**Som** bruker
**Vil jeg** kunne se og laste ned dokumenter
**Slik at** jeg kan verifisere dokumentasjonen

**Akseptansekriterier:**
- [ ] Liste over dokumenter per transaksjon
- [ ] Forhåndsvisning (PDF)
- [ ] Last ned-knapp
- [ ] Vis hvem som lastet opp og når

---

## Prioritering

### Sprint 1 (Grunnlag)
- US-001, US-002: Autentisering
- US-003: Organisasjon
- US-010, US-011: Selskaper
- US-020, US-021: Aksjonærer

### Sprint 2 (Stiftelse)
- US-030: Stiftelsestransaksjon
- US-080, US-081: Dokumenter

### Sprint 3 (Salg)
- US-040: Salg/overføring

### Sprint 4 (Emisjon og utbytte)
- US-050: Emisjon
- US-060: Utbytte

### Sprint 5 (Rapporter)
- US-070: Aksjeeierbok
- US-071: Transaksjonshistorikk
- US-072: RF-1086 grunnlag

### Backlog
- US-004: Invitere bruker
- US-012: Rediger selskap
- US-013: Selskapsdetaljer
- US-022: Rediger aksjonær
