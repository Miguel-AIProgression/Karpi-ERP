// Kanaal-dispatch voor de universele "Bevestig order"-knop.
//
// De operator denkt in documenten ("bevestig order"), niet in kanalen. Deze
// pure helpers bepalen op basis van het order-label (bron_systeem) en de
// EDI-partnerconfig welk kanaal de orderbevestiging gebruikt:
//   'edi'      → ORDRSP op de uitgaande Transus-wachtrij (geen e-mail)
//   'edi_stil' → EDI-order, maar partner wil geen orderbev (orderbev_uit=false)
//                of partner is (nog) niet actief: bevestig alleen administratief,
//                verstuur niets — een EDI-order krijgt nooit een e-mail.
//   'email'    → klassieke PDF-orderbevestiging per e-mail (stuur-orderbevestiging).
//
// Mirrort qua opzet intake-predicaten.ts / edi-leverweek.ts (pure, testbaar).

export type BevestigingKanaal = 'edi' | 'edi_stil' | 'email'

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
  return 'edi_stil'
}

export interface BevestigStatusVelden {
  bron_systeem?: string | null
  bevestigd_at?: string | null
  edi_bevestigd_op?: string | null
}

/**
 * Eén "is deze order bevestigd"-definitie voor header en overzicht.
 * EDI-orders zijn bevestigd via de EDI-gate (mig 158), gewone orders via de
 * e-mail-gate (mig 304). De gates blijven gescheiden kolommen.
 */
export function isOrderBevestigd(o: BevestigStatusVelden): boolean {
  if (o.bron_systeem === 'edi') return !!o.edi_bevestigd_op
  return !!o.bevestigd_at
}
