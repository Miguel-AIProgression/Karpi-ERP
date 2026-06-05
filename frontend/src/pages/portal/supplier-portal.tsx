import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, CheckCircle2, Package, AlertCircle } from 'lucide-react'

const PORTAL_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/supplier-portal`

interface PortalRegel {
  regel_id: number
  inkooporder_id: number
  inkooporder_nr: string
  order_status: string
  besteldatum: string | null
  leverweek: string | null
  verwacht_datum: string | null
  regel_verwacht_datum: string | null
  order_verwacht_datum: string | null
  regelnummer: number
  artikelnr: string | null
  karpi_code: string | null
  artikel_omschrijving: string | null
  product_omschrijving: string | null
  kwaliteit_code: string | null
  kleur_code: string | null
  besteld_m: number
  geleverd_m: number
  te_leveren_m: number
  eenheid: string
  eta_bijgewerkt_door: 'karpi' | 'leverancier' | null
  eta_bijgewerkt_op: string | null
  leverancier_notitie: string | null
}

interface PortalData {
  leverancier: { id: number; naam: string; woonplaats: string | null }
  regels: PortalRegel[]
}

async function fetchPortalData(token: string): Promise<PortalData> {
  const res = await fetch(`${PORTAL_FUNCTION_URL}?token=${encodeURIComponent(token)}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

async function updateEta(token: string, regel_id: number, verwacht_datum: string, notitie?: string) {
  const res = await fetch(PORTAL_FUNCTION_URL, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, regel_id, verwacht_datum, notitie }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

function isoWeek(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const week1 = new Date(d.getFullYear(), 0, 4)
  const wk = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
  return `Wk ${wk}, ${d.getFullYear()}`
}

function EtaCell({ regel, token }: { regel: PortalRegel; token: string }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(regel.verwacht_datum ?? '')
  const [notitie, setNotitie] = useState(regel.leverancier_notitie ?? '')
  const [saveError, setSaveError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => updateEta(token, regel.regel_id, value, notitie || undefined),
    onSuccess: () => {
      setEditing(false)
      setSaveError(null)
      qc.invalidateQueries({ queryKey: ['portal', token] })
    },
    onError: (e: Error) => setSaveError(e.message),
  })

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <div>
          <div className="font-medium">{formatDate(regel.verwacht_datum)}</div>
          {regel.verwacht_datum && (
            <div className="text-xs text-gray-400">{isoWeek(regel.verwacht_datum)}</div>
          )}
          {regel.eta_bijgewerkt_op && (
            <div className="text-xs text-gray-400 mt-0.5">
              Updated by {regel.eta_bijgewerkt_door === 'leverancier' ? 'you' : 'Karpi'}{' '}
              {formatDate(regel.eta_bijgewerkt_op.slice(0, 10))}
            </div>
          )}
          {regel.leverancier_notitie && (
            <div className="text-xs text-blue-600 mt-0.5 italic">"{regel.leverancier_notitie}"</div>
          )}
        </div>
        <button
          onClick={() => { setEditing(true); setValue(regel.verwacht_datum ?? '') }}
          className="ml-auto flex-shrink-0 text-xs px-2 py-1 rounded border border-gray-200 hover:border-blue-400 hover:text-blue-600 transition-colors"
        >
          Edit
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="block w-full text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-500"
        autoFocus
      />
      <textarea
        value={notitie}
        onChange={(e) => setNotitie(e.target.value)}
        placeholder="Note (optional)…"
        rows={2}
        className="block w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400 resize-none"
      />
      {saveError && <div className="text-xs text-red-500">{saveError}</div>}
      <div className="flex gap-2">
        <button
          onClick={() => mutation.mutate()}
          disabled={!value || mutation.isPending}
          className="flex items-center gap-1 text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          <CheckCircle2 size={13} />
          {mutation.isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={() => { setEditing(false); setSaveError(null) }}
          className="text-xs px-3 py-1 border border-gray-200 rounded hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export function SupplierPortalPage() {
  const { token } = useParams<{ token: string }>()
  const [sortBy, setSortBy] = useState<'eta' | 'order'>('eta')

  const { data, isLoading, error } = useQuery({
    queryKey: ['portal', token],
    queryFn: () => fetchPortalData(token!),
    enabled: !!token,
    retry: false,
    staleTime: 30_000,
  })

  if (!token) {
    return <ErrorScreen message="No portal link provided." />
  }
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    )
  }
  if (error) {
    return <ErrorScreen message={(error as Error).message} />
  }
  if (!data) return null

  const regels = [...data.regels].sort((a, b) => {
    if (sortBy === 'eta') {
      const da = a.verwacht_datum ?? '9999'
      const db = b.verwacht_datum ?? '9999'
      return da < db ? -1 : da > db ? 1 : 0
    }
    return a.inkooporder_nr < b.inkooporder_nr ? -1 : 1
  })

  // Group by purchase order number for display
  const grouped = new Map<string, PortalRegel[]>()
  for (const r of regels) {
    const list = grouped.get(r.inkooporder_nr) ?? []
    list.push(r)
    grouped.set(r.inkooporder_nr, list)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Package size={22} className="text-blue-600" />
            <div>
              <h1 className="font-semibold text-gray-900 text-lg">{data.leverancier.naam}</h1>
              <p className="text-sm text-gray-500">
                Delivery schedule — {data.regels.length} open line{data.regels.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {/* Sort controls */}
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-500">Sort by:</span>
          <button
            onClick={() => setSortBy('eta')}
            className={`px-3 py-1 rounded-full border text-sm transition-colors ${
              sortBy === 'eta'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-gray-300 text-gray-600 hover:border-blue-400'
            }`}
          >
            <CalendarDays size={13} className="inline mr-1" />
            Delivery date
          </button>
          <button
            onClick={() => setSortBy('order')}
            className={`px-3 py-1 rounded-full border text-sm transition-colors ${
              sortBy === 'order'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-gray-300 text-gray-600 hover:border-blue-400'
            }`}
          >
            Order no.
          </button>
        </div>

        {regels.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <CheckCircle2 size={36} className="text-green-400 mx-auto mb-3" />
            <p className="font-medium text-gray-700">All caught up!</p>
            <p className="text-sm text-gray-400 mt-1">No open delivery lines at this time.</p>
          </div>
        )}

        {/* Lines table — mobile-friendly cards on small screens */}
        {regels.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Desktop table header */}
            <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_2fr] text-xs font-medium text-gray-500 uppercase tracking-wide px-5 py-3 border-b border-gray-100 bg-gray-50">
              <div>Product</div>
              <div className="text-right">Ordered</div>
              <div className="text-right">Delivered</div>
              <div className="text-right">Remaining</div>
              <div className="pl-4">Expected delivery</div>
            </div>

            <div className="divide-y divide-gray-100">
              {regels.map((r) => (
                <RegelRow key={r.regel_id} regel={r} token={token!} />
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-gray-400 text-center pb-4">
          You can update the expected delivery date for each line. Changes are saved immediately
          and visible to Karpi in real time.
        </p>
      </main>
    </div>
  )
}

function RegelRow({ regel, token }: { regel: PortalRegel; token: string }) {
  const omschrijving =
    regel.artikel_omschrijving ??
    regel.product_omschrijving ??
    regel.artikelnr ??
    `Line ${regel.regelnummer}`

  const unit = regel.eenheid === 'stuks' ? 'pcs' : 'm'

  return (
    <div className="px-4 py-4">
      {/* Mobile layout */}
      <div className="md:hidden space-y-3">
        <div>
          <div className="font-medium text-gray-900 text-sm">{omschrijving}</div>
          <div className="text-xs text-gray-400 mt-0.5">
            {regel.inkooporder_nr} · Line {regel.regelnummer}
            {regel.karpi_code && <> · {regel.karpi_code}</>}
          </div>
        </div>
        <div className="flex gap-6 text-sm">
          <div>
            <div className="text-xs text-gray-400">Ordered</div>
            <div>{regel.besteld_m} {unit}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">Delivered</div>
            <div>{regel.geleverd_m} {unit}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">Remaining</div>
            <div className="font-semibold text-orange-600">{regel.te_leveren_m} {unit}</div>
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-1">Expected delivery</div>
          <EtaCell regel={regel} token={token} />
        </div>
      </div>

      {/* Desktop layout */}
      <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_2fr] items-start gap-2">
        <div>
          <div className="font-medium text-gray-900 text-sm">{omschrijving}</div>
          <div className="text-xs text-gray-400 mt-0.5">
            {regel.inkooporder_nr} · Line {regel.regelnummer}
            {regel.karpi_code && <> · {regel.karpi_code}</>}
          </div>
        </div>
        <div className="text-right text-sm pt-0.5">{regel.besteld_m} {unit}</div>
        <div className="text-right text-sm pt-0.5">{regel.geleverd_m} {unit}</div>
        <div className="text-right text-sm font-semibold text-orange-600 pt-0.5">
          {regel.te_leveren_m} {unit}
        </div>
        <div className="pl-4">
          <EtaCell regel={regel} token={token} />
        </div>
      </div>
    </div>
  )
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
        <AlertCircle size={36} className="text-red-400 mx-auto mb-3" />
        <h1 className="font-semibold text-gray-800 mb-2">Link not valid</h1>
        <p className="text-sm text-gray-500">{message}</p>
        <p className="text-xs text-gray-400 mt-4">
          Please contact Karpi to request a new portal link.
        </p>
      </div>
    </div>
  )
}
