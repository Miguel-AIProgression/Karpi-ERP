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
  order_id: number
  regelnummer: number
  artikelnr: string | null
  omschrijving: string
  omschrijving_2: string | null
  orderaantal: number
  prijs: number | null
  korting_pct: number
  bedrag: number | null
  is_maatwerk: boolean | null
  maatwerk_lengte_cm: number | null
  maatwerk_breedte_cm: number | null
  maatwerk_diameter_cm: number | null
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

  // Haal alle orderregels op in één batch-query
  const orderIds = orders.map((o) => o.id)
  const { data: regelData } = await supabase
    .from('order_regels')
    .select('order_id, regelnummer, artikelnr, omschrijving, omschrijving_2, orderaantal, prijs, korting_pct, bedrag, is_maatwerk, maatwerk_lengte_cm, maatwerk_breedte_cm, maatwerk_diameter_cm')
    .in('order_id', orderIds)
    .order('order_id')
    .order('regelnummer')

  const regelsPerOrder = new Map<number, ExportRegel[]>()
  for (const r of (regelData ?? []) as ExportRegel[]) {
    const bestaand = regelsPerOrder.get(r.order_id) ?? []
    bestaand.push(r)
    regelsPerOrder.set(r.order_id, bestaand)
  }

  const rijen: Record<string, string | number>[] = []

  for (const o of orders) {
    const orderNr = o.order_nr ?? (o.oud_order_nr ? `OUD-${o.oud_order_nr}` : '')
    const orderdatum = formatDatum(o.orderdatum)
    const klant = o.klant_naam ?? ''
    const debiteurNr = o.debiteur_nr
    const referentie = o.klant_referentie ?? ''
    const verzendweek = formatVerzendweek(o.afleverdatum, o.lever_type)
    const statusStr = o.status
    const kanaal = o.bron_systeem ? (BRON_LABEL[o.bron_systeem] ?? o.bron_systeem) : 'Handmatig'

    const regels = regelsPerOrder.get(o.id) ?? []

    if (regels.length === 0) {
      // Order zonder regels: één rij zonder regeldetails
      rijen.push({
        'Order nr': orderNr,
        'Orderdatum': orderdatum,
        'Klant': klant,
        'Debiteur nr': debiteurNr,
        'Klant referentie': referentie,
        'Verzendweek': verzendweek,
        'Status': statusStr,
        'Kanaal': kanaal,
        'Artikelnr': '',
        'Omschrijving': '',
        'Maat': '',
        'Aantal': '',
        'Prijs': '',
        'Korting %': '',
        'Bedrag excl. BTW': '',
      })
    }

    for (const r of regels) {
      const maat = r.is_maatwerk
        ? [
            r.maatwerk_lengte_cm != null && r.maatwerk_breedte_cm != null
              ? `${r.maatwerk_lengte_cm}×${r.maatwerk_breedte_cm} cm`
              : null,
            r.maatwerk_diameter_cm != null
              ? `⌀${r.maatwerk_diameter_cm} cm`
              : null,
          ]
            .filter(Boolean)
            .join(', ')
        : ''

      const omschrijving = [r.omschrijving, r.omschrijving_2].filter(Boolean).join(' — ')

      rijen.push({
        'Order nr': orderNr,
        'Orderdatum': orderdatum,
        'Klant': klant,
        'Debiteur nr': debiteurNr,
        'Klant referentie': referentie,
        'Verzendweek': verzendweek,
        'Status': statusStr,
        'Kanaal': kanaal,
        'Artikelnr': r.artikelnr ?? '',
        'Omschrijving': omschrijving,
        'Maat': maat,
        'Aantal': r.orderaantal,
        'Prijs': r.prijs ?? '',
        'Korting %': r.korting_pct > 0 ? r.korting_pct : '',
        'Bedrag excl. BTW': r.bedrag ?? '',
      })
    }
  }

  const ws = XLSX.utils.json_to_sheet(rijen)
  ws['!cols'] = [
    { wch: 16 }, // Order nr
    { wch: 12 }, // Orderdatum
    { wch: 35 }, // Klant
    { wch: 12 }, // Debiteur nr
    { wch: 22 }, // Klant referentie
    { wch: 14 }, // Verzendweek
    { wch: 22 }, // Status
    { wch: 12 }, // Kanaal
    { wch: 14 }, // Artikelnr
    { wch: 40 }, // Omschrijving
    { wch: 18 }, // Maat
    { wch: 8  }, // Aantal
    { wch: 10 }, // Prijs
    { wch: 10 }, // Korting %
    { wch: 16 }, // Bedrag
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Orders')

  const datum = new Date()
  const datumStr = `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}-${String(datum.getDate()).padStart(2, '0')}`
  XLSX.writeFile(wb, `${bestandsnaam}-${datumStr}.xlsx`)
}
