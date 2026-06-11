# Order e-mailtijdlijn — design

**Datum:** 2026-06-11 · **Status:** goedgekeurd door Miguel (sectie i.p.v. tabs, in-app dialog, backfill zonder inhoud)

## Doel

Op de order-detailpagina een sectie "E-mails" met een tijdlijn van alle voor die order
verstuurde mails (facturen + orderbevestigingen). Per mail: datum/tijd, soort-badge en
het onderwerp; klik opent een in-app dialog met ontvanger(s), de volledige mail-inhoud
en klikbare bijlagen.

## Datamodel (mig 362)

Nieuwe tabel `verstuurde_emails` — één rij per verstuurde mail **per order**:

| kolom | type | toelichting |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `order_id` | BIGINT NOT NULL FK orders ON DELETE CASCADE | tijdlijn-sleutel |
| `factuur_id` | BIGINT NULL FK facturen ON DELETE SET NULL | alleen bij soort 'factuur' |
| `soort` | TEXT CHECK ('factuur','orderbevestiging') | uitbreidbaar via migratie |
| `onderwerp` | TEXT NOT NULL | letterlijke mail-subject |
| `verzonden_aan` | TEXT NOT NULL | komma-gescheiden ontvangers |
| `verzonden_op` | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| `html` | TEXT NULL | mail-body; NULL = inhoud niet bewaard (backfill) |
| `bijlagen` | JSONB NOT NULL DEFAULT '[]' | `[{filename, bucket, path}]` |

Index op `order_id`. RLS: SELECT voor `authenticated`; geen insert/update/delete-policies —
schrijven gebeurt uitsluitend via service-role (edge functions) en de backfill.

Bundel-factuur over meerdere orders ⇒ rij per order (order-ids uit `factuur_regels`).
Betaler-kopie ⇒ eigen rij (eigen onderwerp "… (kopie voor betaler)").

Nieuwe **private storage-bucket `orderbevestigingen`** (spiegelt bucket `facturen`,
mig 123-patroon), pad `{order_id}/Orderbevestiging-{order_nr}.pdf`, upsert.

### Backfill (zelfde migratie)

- Facturen met `verstuurd_op IS NOT NULL` en `verstuurd_naar` met een `@` (EDI-only
  facturen met `verstuurd_naar='EDI Transus'` slaan we over): rij per order uit
  `factuur_regels`, onderwerp `Factuur {factuur_nr}`, bijlagen = factuur-PDF
  (`pdf_storage_path`, bucket `facturen`) + AV (bucket `documenten`). `html` NULL.
- Orders met `bevestigd_at IS NOT NULL` en `bevestiging_email`: rij met onderwerp
  `Orderbevestiging {klantnaam} {order_nr}` (NL-reconstructie — taal van destijds is
  niet bewaard), `html` NULL, `bijlagen` `[]` (PDF werd niet bewaard).

## Edge functions (logging best-effort: try/catch + console.warn, mailen blokkeert nooit)

- **`factuur-verzenden`**: na elke geslaagde `sendFactuurEmail` één log-rij per
  betrokken order. Bijlagen: factuur-PDF + AV.
- **`stuur-orderbevestiging`**: na geslaagde send eerst de al gegenereerde PDF
  uploaden naar bucket `orderbevestigingen` (upsert), daarna log-rij met het
  taalafhankelijke onderwerp, de HTML-body en de PDF als bijlage.

## Frontend

- `frontend/src/lib/supabase/queries/verstuurde-emails.ts`: `fetchEmailsVoorOrder(orderId)`
  + `getEmailBijlageSignedUrl(bucket, path)` (signed URL 600 s, zelfde patroon als facturen).
- Hook `useEmailsVoorOrder` (React Query, key `['verstuurde-emails', orderId]`).
- `frontend/src/components/orders/order-emails.tsx`: sectie in de stijl van
  `OrderEventsTijdlijn`, onder de Facturatie-sectie in `order-detail.tsx`. Per mail:
  tijdstip, badge (Factuur / Orderbevestiging), klikbaar onderwerp.
- `frontend/src/components/orders/order-email-dialog.tsx`: onderwerp, aan, datum,
  body gerenderd in **sandboxed iframe** (`srcDoc`, `sandbox=""` — mail-HTML mag nooit
  scripts draaien in RugFlow), bijlage-knoppen → signed URL in nieuw tabblad.
  `html IS NULL` ⇒ melding "Inhoud niet bewaard (verstuurd vóór de e-mailtijdlijn)".

## Niet in scope

- EDI-INVOIC-berichten (geen e-mail; zichtbaar in de EDI-module).
- Inkomende mail (het bestaande `EmailInhoudPanel` voor `bron_systeem='email'` blijft).
- Mails die niet aan een order hangen.

## Uitrol

Branch `feat/order-email-tijdlijn` (worktree). Migratie handmatig toepassen,
`factuur-verzenden` + `stuur-orderbevestiging` handmatig herdeployen.
