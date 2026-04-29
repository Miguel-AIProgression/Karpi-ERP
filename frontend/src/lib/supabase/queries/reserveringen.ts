import { supabase } from '../client'

export type LevertijdStatus =
  | 'voorraad'
  | 'op_inkoop'
  | 'wacht_op_nieuwe_inkoop'
  | 'maatwerk'

export type LeverModus = 'deelleveringen' | 'in_een_keer'

export type ClaimBron = 'voorraad' | 'inkooporder_regel'
export type ClaimStatus = 'actief' | 'geleverd' | 'released'

export interface OrderRegelLevertijd {
  order_regel_id: number
  order_id: number
  te_leveren: number
  is_maatwerk: boolean
  lever_modus: LeverModus | null
  aantal_voorraad: number
  aantal_io: number
  aantal_tekort: number
  eerste_io_datum: string | null
  laatste_io_datum: string | null
  /** IO-nummer van de eerstkomende geclaimde inkooporder (mig 156). */
  eerste_io_nr: string | null
  /** IO-nummer van de laatste geclaimde inkooporder (mig 156). */
  laatste_io_nr: string | null
  /** Aantal verschillende IO's waarop de regel is gesplitst (mig 156). */
  aantal_io_orders: number
  verwachte_leverweek: string | null
  levertijd_status: LevertijdStatus
}

export interface OrderClaim {
  id: number
  order_regel_id: number
  bron: ClaimBron
  inkooporder_regel_id: number | null
  inkooporder_id: number | null
  inkooporder_nr: string | null
  verwacht_datum: string | null
  aantal: number
  status: ClaimStatus
  claim_volgorde: string
  /** Wat fysiek wordt afgenomen — kan afwijken van orderregel.artikelnr bij omstickeren. Migratie 154. */
  fysiek_artikelnr: string | null
  /** true = handmatige uitwisselbaar-keuze door gebruiker. Migratie 154. */
  is_handmatig: boolean
  /** Omschrijving van fysiek_artikelnr — alleen gevuld bij omstickeren (fysiek != orderregel.artikelnr). */
  fysiek_omschrijving: string | null
  /** Locatie van fysiek_artikelnr — alleen gevuld bij omstickeren (fysiek != orderregel.artikelnr). */
  fysiek_locatie: string | null
}

export interface IORegelClaim {
  id: number
  aantal: number
  claim_volgorde: string
  order_regel_id: number
  order_regelnummer: number
  order_omschrijving: string
  order_id: number
  order_nr: string
  debiteur_nr: number | null
  klant_naam: string | null
}

export async function fetchLevertijdVoorOrder(orderId: number): Promise<OrderRegelLevertijd[]> {
  const { data, error } = await supabase
    .from('order_regel_levertijd')
    .select('*')
    .eq('order_id', orderId)
  if (error) throw error
  return (data ?? []) as OrderRegelLevertijd[]
}

export interface HandmatigeKeuzePerRegel {
  order_regel_id: number
  artikelnr: string
  aantal: number
  omschrijving: string
}

/**
 * Haalt alle actieve, handmatige uitwisselbaar-claims voor een order op,
 * gegroepeerd per orderregel — gebruikt om edit-mode te hydrateren met de
 * bestaande gebruiker-keuzes.
 */
export async function fetchHandmatigeKeuzesVoorOrder(orderId: number): Promise<HandmatigeKeuzePerRegel[]> {
  const { data: regels } = await supabase
    .from('order_regels')
    .select('id')
    .eq('order_id', orderId)
  const regelIds = ((regels ?? []) as { id: number }[]).map(r => r.id)
  if (regelIds.length === 0) return []

  const { data: claims, error } = await supabase
    .from('order_reserveringen')
    .select('order_regel_id, fysiek_artikelnr, aantal')
    .eq('status', 'actief')
    .eq('is_handmatig', true)
    .in('order_regel_id', regelIds)
  if (error) throw error

  const claimRows = ((claims ?? []) as { order_regel_id: number; fysiek_artikelnr: string | null; aantal: number }[])
    .filter(c => !!c.fysiek_artikelnr)
  if (claimRows.length === 0) return []

  const artikelnrs = [...new Set(claimRows.map(c => c.fysiek_artikelnr as string))]
  const { data: producten } = await supabase
    .from('producten')
    .select('artikelnr, omschrijving')
    .in('artikelnr', artikelnrs)
  const omschrijvingMap = new Map<string, string>(
    ((producten ?? []) as { artikelnr: string; omschrijving: string }[]).map(p => [p.artikelnr, p.omschrijving]),
  )

  return claimRows.map(c => ({
    order_regel_id: c.order_regel_id,
    artikelnr: c.fysiek_artikelnr as string,
    aantal: c.aantal,
    omschrijving: omschrijvingMap.get(c.fysiek_artikelnr as string) ?? c.fysiek_artikelnr as string,
  }))
}

export async function fetchClaimsVoorOrderRegel(orderRegelId: number): Promise<OrderClaim[]> {
  const { data, error } = await supabase
    .from('order_reserveringen')
    .select(`
      id, order_regel_id, bron, inkooporder_regel_id, aantal, status, claim_volgorde,
      fysiek_artikelnr, is_handmatig,
      inkooporder_regels:inkooporder_regel_id (
        inkooporders:inkooporder_id ( id, inkooporder_nr, verwacht_datum )
      )
    `)
    .eq('order_regel_id', orderRegelId)
    .eq('status', 'actief')
    .order('bron')
    .order('claim_volgorde')
  if (error) throw error

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(row => {
    const io = row.inkooporder_regels?.inkooporders
    return {
      id: row.id,
      order_regel_id: row.order_regel_id,
      bron: row.bron as ClaimBron,
      inkooporder_regel_id: row.inkooporder_regel_id,
      inkooporder_id: io?.id ?? null,
      inkooporder_nr: io?.inkooporder_nr ?? null,
      verwacht_datum: io?.verwacht_datum ?? null,
      aantal: row.aantal,
      status: row.status as ClaimStatus,
      claim_volgorde: row.claim_volgorde,
      fysiek_artikelnr: row.fysiek_artikelnr ?? null,
      is_handmatig: !!row.is_handmatig,
      fysiek_omschrijving: null,
      fysiek_locatie: null,
    }
  })
}

/**
 * Haalt alle actieve claims voor een complete order op, één query + één
 * batched product-lookup voor de fysiek_artikelnr-omsticker-info. Wordt
 * gebruikt door de orderregel-tabel om per regel de claim-uitsplitsing
 * te tonen als geneste sub-rijen.
 */
export async function fetchClaimsVoorOrder(orderId: number): Promise<OrderClaim[]> {
  // Stap 1: orderregel-ids voor deze order
  const { data: regels } = await supabase
    .from('order_regels')
    .select('id, artikelnr')
    .eq('order_id', orderId)
  const regelIds = ((regels ?? []) as { id: number }[]).map(r => r.id)
  if (regelIds.length === 0) return []
  const regelArtikelMap = new Map<number, string | null>(
    ((regels ?? []) as { id: number; artikelnr: string | null }[]).map(r => [r.id, r.artikelnr]),
  )

  // Stap 2: actieve claims voor die regels
  const { data, error } = await supabase
    .from('order_reserveringen')
    .select(`
      id, order_regel_id, bron, inkooporder_regel_id, aantal, status, claim_volgorde,
      fysiek_artikelnr, is_handmatig,
      inkooporder_regels:inkooporder_regel_id (
        inkooporders:inkooporder_id ( id, inkooporder_nr, verwacht_datum )
      )
    `)
    .in('order_regel_id', regelIds)
    .eq('status', 'actief')
    .order('bron')
    .order('claim_volgorde')
  if (error) throw error

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const claimRows = (data ?? []) as any[]
  if (claimRows.length === 0) return []

  // Stap 3: omschrijving + locatie van afwijkende fysiek_artikelnrs (omsticker-bronnen)
  const omstickerArtikelnrs = [...new Set(
    claimRows
      .filter(r => r.fysiek_artikelnr && r.fysiek_artikelnr !== regelArtikelMap.get(r.order_regel_id))
      .map(r => r.fysiek_artikelnr as string),
  )]
  const productMap = new Map<string, { omschrijving: string; locatie: string | null }>()
  if (omstickerArtikelnrs.length > 0) {
    const { data: producten } = await supabase
      .from('producten')
      .select('artikelnr, omschrijving, locatie')
      .in('artikelnr', omstickerArtikelnrs)
    for (const p of (producten ?? []) as { artikelnr: string; omschrijving: string; locatie: string | null }[]) {
      productMap.set(p.artikelnr, { omschrijving: p.omschrijving, locatie: p.locatie })
    }
  }

  return claimRows.map(row => {
    const io = row.inkooporder_regels?.inkooporders
    const regelArtikel = regelArtikelMap.get(row.order_regel_id)
    const isOmsticker = row.fysiek_artikelnr && row.fysiek_artikelnr !== regelArtikel
    const fysiekInfo = isOmsticker ? productMap.get(row.fysiek_artikelnr) : null
    return {
      id: row.id,
      order_regel_id: row.order_regel_id,
      bron: row.bron as ClaimBron,
      inkooporder_regel_id: row.inkooporder_regel_id,
      inkooporder_id: io?.id ?? null,
      inkooporder_nr: io?.inkooporder_nr ?? null,
      verwacht_datum: io?.verwacht_datum ?? null,
      aantal: row.aantal,
      status: row.status as ClaimStatus,
      claim_volgorde: row.claim_volgorde,
      fysiek_artikelnr: row.fysiek_artikelnr ?? null,
      is_handmatig: !!row.is_handmatig,
      fysiek_omschrijving: fysiekInfo?.omschrijving ?? null,
      fysiek_locatie: fysiekInfo?.locatie ?? null,
    }
  })
}

export async function fetchClaimsVoorIORegel(ioRegelId: number): Promise<IORegelClaim[]> {
  const { data, error } = await supabase
    .from('order_reserveringen')
    .select(`
      id, aantal, claim_volgorde,
      order_regels:order_regel_id (
        id, regelnummer, omschrijving,
        orders:order_id ( id, order_nr, debiteur_nr )
      )
    `)
    .eq('inkooporder_regel_id', ioRegelId)
    .eq('bron', 'inkooporder_regel')
    .eq('status', 'actief')
    .order('claim_volgorde')
  if (error) throw error

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[]
  if (rows.length === 0) return []

  // Klant-namen ophalen voor alle distinct debiteur_nrs
  const debiteurNrs = [...new Set(rows.map(r => r.order_regels?.orders?.debiteur_nr).filter((n: number | null) => n != null))] as number[]
  const naamMap = new Map<number, string>()
  if (debiteurNrs.length > 0) {
    const { data: debs } = await supabase
      .from('debiteuren')
      .select('debiteur_nr, naam')
      .in('debiteur_nr', debiteurNrs)
    for (const d of (debs ?? []) as { debiteur_nr: number; naam: string }[]) {
      naamMap.set(d.debiteur_nr, d.naam)
    }
  }

  return rows.map(row => {
    const reg = row.order_regels
    const ord = reg?.orders
    const debNr = ord?.debiteur_nr ?? null
    return {
      id: row.id,
      aantal: row.aantal,
      claim_volgorde: row.claim_volgorde,
      order_regel_id: reg?.id ?? 0,
      order_regelnummer: reg?.regelnummer ?? 0,
      order_omschrijving: reg?.omschrijving ?? '',
      order_id: ord?.id ?? 0,
      order_nr: ord?.order_nr ?? '',
      debiteur_nr: debNr,
      klant_naam: debNr != null ? naamMap.get(debNr) ?? null : null,
    }
  })
}
