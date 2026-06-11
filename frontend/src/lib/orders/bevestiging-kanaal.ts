// Kanaal-dispatch voor de universele "Bevestig order"-knop.
//
// De operator denkt in documenten ("bevestig order"), niet in kanalen. Deze
// pure helpers bepalen op basis van het order-label (bron_systeem) en de
// EDI-partnerconfig welk kanaal de orderbevestiging gebruikt:
//   'edi'   → ORDRSP op de uitgaande Transus-wachtrij (geen e-mail)
//   'email' → klassieke PDF-orderbevestiging per e-mail (stuur-orderbevestiging).
//
// Besluit 2026-06-11 (Miguel): EDI-orders van partners zonder actieve
// EDI-orderbev krijgen de orderbevestiging gewoon per e-mail. De "EDI nooit
// via mail"-regel geldt per documenttype: alleen documenten die de partner via
// EDI wil, gaan via EDI. Het kanaal 'edi_stil' bestaat niet meer.
//
// Mirrort qua opzet intake-predicaten.ts / edi-leverweek.ts (pure, testbaar).

export type BevestigingKanaal = 'edi' | 'email'

export interface KanaalConfig {
  transus_actief: boolean
  orderbev_uit: boolean
}

export function bepaalBevestigingKanaal(
  bronSysteem: string | null | undefined,
  config: KanaalConfig | null,
): BevestigingKanaal {
  if (bronSysteem !== 'edi') return 'email'
  if (config?.transus_actief && config.orderbev_uit) return 'edi'
  // Partner wil/kan geen EDI-orderbev → gewoon per e-mail (besluit 11-06)
  return 'email'
}

export interface BevestigStatusVelden {
  bron_systeem?: string | null
  bevestigd_at?: string | null
  edi_bevestigd_op?: string | null
}

/**
 * Eén "is deze order bevestigd"-definitie voor header en overzicht.
 *
 * Met optioneel kanaal (als de config al geladen is):
 *   kanaal 'edi'   → kijkt naar edi_bevestigd_op (ORDRSP verstuurd)
 *   kanaal 'email' → kijkt naar bevestigd_at (mail verstuurd); bij een
 *                    EDI-order via het email-kanaal telt de leverweek-gate
 *                    (edi_bevestigd_op) alleen niet: de partner heeft de mail
 *                    nog niet ontvangen.
 *
 * Zonder kanaal (callers die de config nog niet kennen): oud gedrag —
 *   EDI-order → edi_bevestigd_op, anders → bevestigd_at.
 */
export function isOrderBevestigd(
  o: BevestigStatusVelden,
  kanaal?: BevestigingKanaal,
): boolean {
  if (kanaal === 'edi') return !!o.edi_bevestigd_op
  if (kanaal === 'email') return !!o.bevestigd_at
  // Fallback oud gedrag (kanaal nog onbekend)
  if (o.bron_systeem === 'edi') return !!o.edi_bevestigd_op
  return !!o.bevestigd_at
}
