// Levertijd-Module — type-declaraties (ADR-0020).
//
// Bezit het order-niveau `levertijd_status`-label, de fit-check (kan een
// klant-gevraagde week gehaald worden?) en het snelste-haalbaar resultaat
// (wat is de eerstvolgende week waarop deze regel geleverd kan worden?).
//
// Semantische scheiding met `reserveringen/queries/reserveringen.ts` die
// óók een `LevertijdStatus`-type exporteert: dáár gaat het over claim-bron
// per regel ('voorraad' | 'op_inkoop' | 'wacht_op_nieuwe_inkoop' | 'maatwerk'),
// hier over het fit-resultaat per regel/order ('standaard' | 'eerder_..' |
// 'later_..'). Namen leven in losse Module-barrels zodat consumers expliciet
// kiezen welk concept ze importeren.

export type LevertijdStatus =
  | 'standaard'
  | 'eerder_dan_standaard'
  | 'later_dan_standaard'

export interface FitCheckResultaat {
  regel_id: number
  haalbaar: boolean
  reden: string | null
  eerstvolgend_haalbaar: string | null // ISO-week 'YYYY-Www'
}

export interface SnelsteHaalbaarResultaat {
  regel_id: number
  snelste_haalbaar: string // ISO-week 'YYYY-Www'
  spoed_uitleg: string | null
}
