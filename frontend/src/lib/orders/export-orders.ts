import * as XLSX from 'xlsx'
import { fetchOrders } from '@/lib/supabase/queries/orders'
import type { OrderSortField, SortDirection } from '@/lib/supabase/queries/orders'
import { verzendWeekVoor } from '@/lib/orders/verzendweek'
import { supabase } from '@/lib/supabase/client'

const BRON_LABEL: Record<string, string> = {
  edi: 'EDI',
  shopify: 'Shopify',
  lightspeed: 'Lightspeed',
  email: 'E-mail',
  oud_systeem: 'Oud systeem',
  handmatig: 'Handmatig',
}

function formatDatum(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00Z')
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`
}

function formatVerzendweek(iso: string | null | undefined, leverType?: string): string {
  if (!iso) return ''
  if (leverType === 'datum') return formatDatum(iso)
  const w = verzendWeekVoor(iso)
  return w ? `Wk ${w.week} · ${w.jaar}` : ''
}

interface ExportRegel {
  id: number
  order_id: number
  regelnummer: number
  artikelnr: string | null
  karpi_code: string | null
  omschrijving: string
  omschrijving_2: string | null
  orderaantal: number
  te_leveren: number
  backorder: number
  te_factureren: number
  gefactureerd: number
  prijs: number | null
  korting_pct: number
  bedrag: number | null
  gewicht_kg: number | null
  vrije_voorraad: number | null
  is_maatwerk: boolean | null
  maatwerk_lengte_cm: number | null
  maatwerk_breedte_cm: number | null
  maatwerk_diameter_cm: number | null
}

interface ExportOrderDetail {
  id: number
  fact_naam: string | null
  fact_adres: string | null
  fact_postcode: string | null
  fact_plaats: string | null
  fact_land: string | null
  afl_naam: string | null
  afl_naam_2: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_plaats: string | null
  afl_land: string | null
  betaler: number | null
  inkooporganisatie: string | null
  lever_modus: string | null
}

interface ExportLevertijd {
  order_regel_id: number
  eerste_io_datum: string | null
  eerste_io_nr: string | null
  aantal_io: number
}

interface ZendingRij {
  order_id: number
  zendingen: { zending_nr: string; verzenddatum: string | null } | null
}

export async function exporterenNaarExcel(params: {
  status?: string
  search?: string
  debiteurNrs?: number[]
  bronSystemen?: string[]
  sortBy?: OrderSortField
  sortDir?: SortDirection
  bestandsnaam?: string
}) {
  const { bestandsnaam = 'orders-export', ...fetchParams } = params

  const result = await fetchOrders({ ...fetchParams, page: 0, pageSize: 5000 })
  const orders = result.orders

  if (orders.length === 0) return

  const orderIds = orders.map((o) => o.id)

  // Alle benodigde data in parallel ophalen
  const [orderDetailsRes, regelDataRes, levertijdRes, zendingRes] = await Promise.all([
    supabase
      .from('orders')
      .select('id, fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, afl_naam, afl_naam_2, afl_adres, afl_postcode, afl_plaats, afl_land, betaler, inkooporganisatie, lever_modus')
      .in('id', orderIds),
    supabase
      .from('order_regels')
      .select('id, order_id, regelnummer, artikelnr, karpi_code, omschrijving, omschrijving_2, orderaantal, te_leveren, backorder, te_factureren, gefactureerd, prijs, korting_pct, bedrag, gewicht_kg, vrije_voorraad, is_maatwerk, maatwerk_lengte_cm, maatwerk_breedte_cm, maatwerk_diameter_cm')
      .in('order_id', orderIds)
      .order('order_id')
      .order('regelnummer'),
    supabase
      .from('order_regel_levertijd')
      .select('order_regel_id, eerste_io_datum, eerste_io_nr, aantal_io')
      .in('order_id', orderIds),
    // verzenddatum voor Ltste bon, zending_nr voor Pakbonnr.
    supabase
      .from('zending_orders')
      .select('order_id, zendingen!inner(zending_nr, verzenddatum)')
      .in('order_id', orderIds),
  ])

  // Lookup maps bouwen
  const orderDetailMap = new Map<number, ExportOrderDetail>()
  for (const d of (orderDetailsRes.data ?? []) as ExportOrderDetail[]) {
    orderDetailMap.set(d.id, d)
  }

  const regelsPerOrder = new Map<number, ExportRegel[]>()
  for (const r of (regelDataRes.data ?? []) as ExportRegel[]) {
    const bestaand = regelsPerOrder.get(r.order_id) ?? []
    bestaand.push(r)
    regelsPerOrder.set(r.order_id, bestaand)
  }

  const levertijdMap = new Map<number, ExportLevertijd>()
  for (const l of (levertijdRes.data ?? []) as ExportLevertijd[]) {
    levertijdMap.set(l.order_regel_id, l)
  }

  // Per order: oudste verzenddatum (Ltste bon) en alle zending_nrs (Pakbonnr.)
  const ltsteBonPerOrder = new Map<number, string>()
  const pakbonNrsPerOrder = new Map<number, Set<string>>()
  for (const z of (zendingRes.data ?? []) as unknown as ZendingRij[]) {
    const zend = z.zendingen
    if (!zend) continue
    if (zend.verzenddatum) {
      const bestaand = ltsteBonPerOrder.get(z.order_id)
      if (!bestaand || zend.verzenddatum < bestaand) {
        ltsteBonPerOrder.set(z.order_id, zend.verzenddatum)
      }
    }
    if (zend.zending_nr) {
      if (!pakbonNrsPerOrder.has(z.order_id)) pakbonNrsPerOrder.set(z.order_id, new Set())
      pakbonNrsPerOrder.get(z.order_id)!.add(zend.zending_nr)
    }
  }

  // Betaler-namen batch ophalen
  const betaalderNrs = [...new Set(
    Array.from(orderDetailMap.values())
      .map((d) => d.betaler)
      .filter((b): b is number => b != null),
  )]
  const betaalderNaamMap = new Map<number, string>()
  if (betaalderNrs.length > 0) {
    const { data: betalers } = await supabase
      .from('debiteuren')
      .select('debiteur_nr, naam')
      .in('debiteur_nr', betaalderNrs)
    for (const b of (betalers ?? []) as { debiteur_nr: number; naam: string }[]) {
      betaalderNaamMap.set(b.debiteur_nr, b.naam)
    }
  }

  const rijen: Record<string, string | number>[] = []

  for (const o of orders) {
    const orderNr = o.order_nr ?? (o.oud_order_nr ? `OUD-${o.oud_order_nr}` : '')
    const orderdatum = formatDatum(o.orderdatum)
    const debiteurNr = o.debiteur_nr
    const referentie = o.klant_referentie ?? ''
    const verzendweek = formatVerzendweek(o.afleverdatum, o.lever_type)
    const afleverdatum = formatDatum(o.afleverdatum)
    const vertegenw = o.vertegenw_code ?? ''
    const statusStr = o.status
    const kanaal = o.bron_systeem ? (BRON_LABEL[o.bron_systeem] ?? o.bron_systeem) : 'Handmatig'

    const detail = orderDetailMap.get(o.id)
    const betaler = detail?.betaler ?? ''
    const betaalderNaam = detail?.betaler != null ? (betaalderNaamMap.get(detail.betaler) ?? '') : ''
    const inkooporg = detail?.inkooporganisatie ?? ''
    const compleetLev = detail?.lever_modus === 'in_een_keer' ? 'J' : detail?.lever_modus === 'deelleveringen' ? 'N' : ''
    const ltsteBon = formatDatum(ltsteBonPerOrder.get(o.id))
    const pakbon = Array.from(pakbonNrsPerOrder.get(o.id) ?? []).join(', ')

    const regels = regelsPerOrder.get(o.id) ?? []

    // Vaste order-velden (dezelfde volgorde als oud systeem, kolom 1-22)
    const orderVelden = {
      'Debiteur': debiteurNr,
      'Order': orderNr,
      'Orderdatum': orderdatum,
      'Klantref.': referentie,
      'Afleverdatum': afleverdatum,
      'Week': verzendweek,
      'Fct.naam': detail?.fact_naam ?? '',
      'Fct.adres': detail?.fact_adres ?? '',
      'Fct.postc': detail?.fact_postcode ?? '',
      'Fct.Plaats': detail?.fact_plaats ?? '',
      'Fact.Land': detail?.fact_land ?? '',
      'Afl.naam': detail?.afl_naam ?? '',
      'Naam2': detail?.afl_naam_2 ?? '',
      'Afl.adres': detail?.afl_adres ?? '',
      'Afl.Postcd': detail?.afl_postcode ?? '',
      'Afl.Plaats': detail?.afl_plaats ?? '',
      'Afl.land': detail?.afl_land ?? '',
      'Betaler': betaler,
      'Naam': betaalderNaam,
      'Ink.Org': inkooporg,
    }

    if (regels.length === 0) {
      rijen.push({
        ...orderVelden,
        'Regel': '', 'Artikelnr': '', 'Karpi-code': '',
        'Omschrijving': '', 'Omschrijving 2': '', 'Orderaantal': '',
        'Prijs': '', 'Kort.%': '', 'Bedrag': '',
        'Te lev.': '', 'Backorder': '', 'Te fact.': '', 'Gefact.': '',
        'Vert.': vertegenw, 'Ltste bon': ltsteBon, 'Compl.Lev.': compleetLev,
        'VrijVoorr.': '', 'Volg.ontvangst': '', 'Verwacht aantal': '',
        'Gewicht': '', 'Inkooporder J/N': '', 'Nummer inkooporder': '', 'Pakbonnr.': pakbon,
        // Extra Rugflow-kolommen (niet in oud systeem)
        'Maat': '', 'Status': statusStr, 'Kanaal': kanaal,
      })
      continue
    }

    for (const r of regels) {
      const maat = r.is_maatwerk
        ? [
            r.maatwerk_lengte_cm != null && r.maatwerk_breedte_cm != null
              ? `${r.maatwerk_lengte_cm}×${r.maatwerk_breedte_cm} cm`
              : null,
            r.maatwerk_diameter_cm != null ? `⌀${r.maatwerk_diameter_cm} cm` : null,
          ].filter(Boolean).join(', ')
        : ''

      const lev = levertijdMap.get(r.id)
      const heeftIO = (lev?.aantal_io ?? 0) > 0

      rijen.push({
        ...orderVelden,
        // Regeldetails (kolom 22-44, zelfde volgorde als oud systeem)
        'Regel': r.regelnummer,
        'Artikelnr': r.artikelnr ?? '',   // Let op: in oud systeem was dit numeriek; in Rugflow tekst
        'Karpi-code': r.karpi_code ?? '',
        'Omschrijving': r.omschrijving,
        'Omschrijving 2': r.omschrijving_2 ?? '',
        'Orderaantal': r.orderaantal,
        'Prijs': r.prijs ?? '',
        'Kort.%': r.korting_pct > 0 ? r.korting_pct : '',
        'Bedrag': r.bedrag ?? '',
        'Te lev.': r.te_leveren,
        'Backorder': r.backorder,
        'Te fact.': r.te_factureren,
        'Gefact.': r.gefactureerd,
        'Vert.': vertegenw,
        'Ltste bon': ltsteBon,
        'Compl.Lev.': compleetLev,
        'VrijVoorr.': r.vrije_voorraad ?? '',
        'Volg.ontvangst': formatDatum(lev?.eerste_io_datum),
        'Verwacht aantal': lev ? (lev.aantal_io || '') : '',
        'Gewicht': r.gewicht_kg ?? '',
        'Inkooporder J/N': lev ? (heeftIO ? 'J' : 'N') : '',
        'Nummer inkooporder': lev?.eerste_io_nr ?? '',
        'Pakbonnr.': pakbon,
        // Extra Rugflow-kolommen (niet in oud systeem)
        'Maat': maat,
        'Status': statusStr,
        'Kanaal': kanaal,
      })
    }
  }

  const ws = XLSX.utils.json_to_sheet(rijen)
  ws['!cols'] = [
    { wch: 10 }, // Debiteur
    { wch: 16 }, // Order
    { wch: 12 }, // Orderdatum
    { wch: 22 }, // Klantref.
    { wch: 12 }, // Afleverdatum
    { wch: 14 }, // Week
    { wch: 30 }, // Fct.naam
    { wch: 25 }, // Fct.adres
    { wch: 10 }, // Fct.postc
    { wch: 20 }, // Fct.Plaats
    { wch: 14 }, // Fact.Land
    { wch: 30 }, // Afl.naam
    { wch: 20 }, // Naam2
    { wch: 25 }, // Afl.adres
    { wch: 10 }, // Afl.Postcd
    { wch: 20 }, // Afl.Plaats
    { wch: 12 }, // Afl.land
    { wch: 10 }, // Betaler
    { wch: 30 }, // Naam
    { wch: 20 }, // Ink.Org
    { wch: 8  }, // Regel
    { wch: 14 }, // Artikelnr
    { wch: 18 }, // Karpi-code
    { wch: 40 }, // Omschrijving
    { wch: 30 }, // Omschrijving 2
    { wch: 10 }, // Orderaantal
    { wch: 10 }, // Prijs
    { wch: 10 }, // Kort.%
    { wch: 12 }, // Bedrag
    { wch: 8  }, // Te lev.
    { wch: 10 }, // Backorder
    { wch: 10 }, // Te fact.
    { wch: 10 }, // Gefact.
    { wch: 8  }, // Vert.
    { wch: 12 }, // Ltste bon
    { wch: 12 }, // Compl.Lev.
    { wch: 12 }, // VrijVoorr.
    { wch: 14 }, // Volg.ontvangst
    { wch: 16 }, // Verwacht aantal
    { wch: 10 }, // Gewicht
    { wch: 14 }, // Inkooporder J/N
    { wch: 20 }, // Nummer inkooporder
    { wch: 14 }, // Pakbonnr.
    { wch: 18 }, // Maat (extra)
    { wch: 22 }, // Status (extra)
    { wch: 12 }, // Kanaal (extra)
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Orders')

  const datum = new Date()
  const datumStr = `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}-${String(datum.getDate()).padStart(2, '0')}`
  XLSX.writeFile(wb, `${bestandsnaam}-${datumStr}.xlsx`)
}
