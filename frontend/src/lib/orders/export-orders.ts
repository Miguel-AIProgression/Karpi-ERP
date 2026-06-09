import * as XLSX from 'xlsx'
import { fetchOrders } from '@/lib/supabase/queries/orders'
import type { OrderSortField, SortDirection } from '@/lib/supabase/queries/orders'
import { verzendWeekVoor } from '@/lib/orders/verzendweek'

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

  const rijen = orders.map((o) => ({
    'Order nr': o.order_nr ?? (o.oud_order_nr ? `OUD-${o.oud_order_nr}` : ''),
    'Orderdatum': formatDatum(o.orderdatum),
    'Klant': o.klant_naam ?? '',
    'Debiteur nr': o.debiteur_nr,
    'Klant referentie': o.klant_referentie ?? '',
    'Verzendweek': formatVerzendweek(o.afleverdatum, o.lever_type),
    'Status': o.status,
    'Kanaal': o.bron_systeem ? (BRON_LABEL[o.bron_systeem] ?? o.bron_systeem) : 'Handmatig',
    'Regels': o.aantal_regels,
    'Bedrag excl. BTW': o.totaal_bedrag,
  }))

  const ws = XLSX.utils.json_to_sheet(rijen)
  ws['!cols'] = [
    { wch: 16 }, // Order nr
    { wch: 12 }, // Orderdatum
    { wch: 35 }, // Klant
    { wch: 12 }, // Debiteur nr
    { wch: 22 }, // Klant referentie
    { wch: 14 }, // Verzendweek
    { wch: 22 }, // Status
    { wch: 14 }, // Kanaal
    { wch: 8  }, // Regels
    { wch: 16 }, // Bedrag
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Orders')

  const datum = new Date()
  const datumStr = `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}-${String(datum.getDate()).padStart(2, '0')}`
  XLSX.writeFile(wb, `${bestandsnaam}-${datumStr}.xlsx`)
}
