// Gedeelde intake-regel-shape voor de Deno-webhook-kanalen (Shopify, Lightspeed
// webhook, Lightspeed cron). Vervangt het ad-hoc `regels: unknown[]` per kanaal.
// Komt 1-op-1 overeen met de kolommen die create_webshop_order(p_regels) verwacht.
// EDI bouwt zijn regels in SQL (create_edi_order) en valt bewust buiten dit type.
export interface IntakeRegel {
  artikelnr: string | null
  omschrijving: string
  omschrijving_2: string | null
  orderaantal: number
  te_leveren: number
  prijs: number | null
  korting_pct: number
  bedrag: number | null
  gewicht_kg: number | null
  is_maatwerk: boolean
  maatwerk_kwaliteit_code: string | null
  maatwerk_kleur_code: string | null
  maatwerk_vorm: string | null
  maatwerk_lengte_cm: number | null
  maatwerk_breedte_cm: number | null
}
