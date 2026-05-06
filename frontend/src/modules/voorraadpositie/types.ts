// Voorraadpositie-Module — types.
//
// Eén concept per (kwaliteit, kleur)-paar:
//   - voorraad: wat heb ik vandaag uit eigen rol
//   - partners: welke uitwisselbare paren kunnen dit aanvullen
//   - beste_partner: invariant — alleen gezet wanneer eigen voorraad = 0
//   - besteld: wat komt binnenkort uit inkoop
//
// Bron: SQL-RPC voorraadposities(p_kwaliteit, p_kleur, p_search) — mig 179.

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
  voorraad: VoorraadEigen
  partners: UitwisselbarePartner[]
  beste_partner: UitwisselbarePartner | null
  besteld: BesteldInkoop
}
