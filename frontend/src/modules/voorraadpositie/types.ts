// Voorraadpositie-Module — types.
//
// Eén concept per (kwaliteit, kleur)-paar:
//   - voorraad: wat heb ik vandaag uit eigen rol
//   - rollen: per-rol details (voor expand-rows in rollen-overzicht)
//   - partners: welke uitwisselbare paren kunnen dit aanvullen
//   - beste_partner: invariant — alleen gezet wanneer eigen voorraad = 0
//   - besteld: wat komt binnenkort uit inkoop
//   - product_naam: één label uit producten-tabel (NULL als geen match)
//
// Bron: SQL-RPC voorraadposities(p_kwaliteit, p_kleur, p_search)
//   - mig 179: single-paar-modus
//   - mig 180: batch+filter-modus + extra kolommen rollen / product_naam /
//              eerstvolgende_m / eerstvolgende_m2

import type { RolRow } from '@/lib/types/productie'

export interface UitwisselbarePartner {
  kwaliteit_code: string
  kleur_code: string
  rollen: number
  m2: number
}

export interface BesteldInkoop {
  besteld_m: number
  besteld_m2: number
  orders_count: number
  eerstvolgende_leverweek: string | null
  eerstvolgende_verwacht_datum: string | null
  /** Meters in de eerstvolgende leverweek (mig 137). 0 als geen besteld. */
  eerstvolgende_m: number
  /** m² in de eerstvolgende leverweek (mig 137). 0 als geen breedte bekend. */
  eerstvolgende_m2: number
}

export interface VoorraadEigen {
  volle_rollen: number
  aangebroken_rollen: number
  reststuk_rollen: number
  totaal_m2: number
}

export interface Voorraadpositie {
  kwaliteit_code: string
  kleur_code: string
  /** Naam uit producten-tabel — NULL als geen match. */
  product_naam: string | null
  voorraad: VoorraadEigen
  /** Per-rol details — gesorteerd rol_type ASC, rolnummer ASC. Lege array bij ghost. */
  rollen: RolRow[]
  partners: UitwisselbarePartner[]
  beste_partner: UitwisselbarePartner | null
  besteld: BesteldInkoop
}

/**
 * Filter-input voor `fetchVoorraadposities` / `useVoorraadposities`.
 * Lege filter (alle velden undefined of leeg) → alle paren met eigen voorraad.
 */
export interface VoorraadpositieFilter {
  /** Gedeeltelijke match op kwaliteit_code (ILIKE %...%). */
  kwaliteit?: string
  /** Exacte match op kleur_code na trailing-.0+-strip. */
  kleur?: string
  /** ILIKE op `kwaliteit-kleur` of producten.naam. */
  search?: string
}
