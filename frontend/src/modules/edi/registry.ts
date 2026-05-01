// Bron-van-waarheid voor de vier EDI-berichttypen.
//
// Frontend itereert hieroverheen (KlantEdiTab proces-lijst, bericht-detail labels,
// berichten-overzicht filter-opties) zodat een nieuw type één entry hier worden i.p.v.
// edits in vier afzonderlijke files.
//
// V2: spiegelen naar supabase/functions/_shared/edi/registry.ts zodat poll/send
// edge functions ook over de registry itereren i.p.v. ad-hoc switch op berichttype.

export type Berichttype = 'order' | 'orderbev' | 'factuur' | 'verzendbericht'
export type Richting = 'in' | 'uit'
export type ConfigToggleKey = 'order_in' | 'orderbev_uit' | 'factuur_uit' | 'verzend_uit'
export type RelatedEntity = 'order' | 'factuur' | 'zending'

export interface BerichttypeDef {
  code: Berichttype
  richting: Richting
  uiLabel: string
  uiSubtitle: string
  configToggleKey: ConfigToggleKey
  relatedEntity: RelatedEntity
  transusProcess: string
}

export const BERICHTTYPE_REGISTRY: Record<Berichttype, BerichttypeDef> = {
  order: {
    code: 'order',
    richting: 'in',
    uiLabel: 'Order ontvangen',
    uiSubtitle: 'Inkomende EDI-orders worden verwerkt',
    configToggleKey: 'order_in',
    relatedEntity: 'order',
    transusProcess: 'ORDERS',
  },
  orderbev: {
    code: 'orderbev',
    richting: 'uit',
    uiLabel: 'Orderbevestiging versturen',
    uiSubtitle: 'Outbound orderbev na orderbevestiging in RugFlow',
    configToggleKey: 'orderbev_uit',
    relatedEntity: 'order',
    transusProcess: 'ORDRSP',
  },
  factuur: {
    code: 'factuur',
    richting: 'uit',
    uiLabel: 'Factuur versturen',
    uiSubtitle: 'INVOIC-bericht na factuur-aanmaak',
    configToggleKey: 'factuur_uit',
    relatedEntity: 'factuur',
    transusProcess: 'INVOIC',
  },
  verzendbericht: {
    code: 'verzendbericht',
    richting: 'uit',
    uiLabel: 'Verzending versturen',
    uiSubtitle: 'DESADV bij verzendmelding',
    configToggleKey: 'verzend_uit',
    relatedEntity: 'zending',
    transusProcess: 'DESADV',
  },
}

export function getBerichttypenVoorRichting(richting: Richting): BerichttypeDef[] {
  return Object.values(BERICHTTYPE_REGISTRY).filter((t) => t.richting === richting)
}

export function getBerichttypeDef(code: Berichttype): BerichttypeDef {
  return BERICHTTYPE_REGISTRY[code]
}
