import { useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Search, Pencil, Check, X, Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { InfoField } from '@/components/ui/info-field'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency } from '@/lib/utils/formatters'
import {
  usePrijslijstDetail,
  usePrijslijstRegels,
  usePrijslijstKlanten,
  useUpdatePrijsRegel,
} from '@/hooks/use-prijslijsten'

type Tab = 'regels' | 'klanten'

export function PrijslijstDetailPage() {
  const { nr } = useParams<{ nr: string }>()
  const prijslijstNr = nr ?? ''

  const { data: header, isLoading } = usePrijslijstDetail(prijslijstNr)
  const { data: regels } = usePrijslijstRegels(prijslijstNr)
  const { data: klanten } = usePrijslijstKlanten(prijslijstNr)

  const [activeTab, setActiveTab] = useState<Tab>('regels')
  const [zoek, setZoek] = useState('')

  if (isLoading) return <PageHeader title="Prijslijst laden..." />
  if (!header) {
    return (
      <>
        <PageHeader title="Prijslijst niet gevonden" />
        <Link to="/prijslijsten" className="text-terracotta-500 hover:underline">
          Terug naar prijslijsten
        </Link>
      </>
    )
  }

  return (
    <>
      <div className="mb-4">
        <Link
          to="/prijslijsten"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} />
          Terug naar prijslijsten
        </Link>
      </div>

      {/* Header */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6 mb-6">
        <h1 className="text-xl font-semibold text-slate-900 mb-1">{header.naam}</h1>
        <div className="flex items-center gap-3 mb-4">
          <span className="font-mono text-sm text-slate-400">{header.nr}</span>
          <StatusBadge status={header.actief ? 'Actief' : 'Inactief'} type="order" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <InfoField
            label="Geldig vanaf"
            value={header.geldig_vanaf ? new Date(header.geldig_vanaf).toLocaleDateString('nl-NL') : null}
          />
          <InfoField label="Artikelen" value={String(regels?.length ?? 0)} />
          <InfoField label="Gekoppelde klanten" value={String(klanten?.length ?? 0)} />
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 mb-4">
        <nav className="flex gap-1 -mb-px">
          {([
            { key: 'regels' as Tab, label: `Prijzen (${regels?.length ?? 0})` },
            { key: 'klanten' as Tab, label: `Klanten (${klanten?.length ?? 0})` },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-terracotta-500 text-terracotta-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200">
        {activeTab === 'regels' && (
          <RegelsTab regels={regels ?? []} zoek={zoek} setZoek={setZoek} prijslijstNr={prijslijstNr} />
        )}
        {activeTab === 'klanten' && <KlantenTab klanten={klanten ?? []} />}
      </div>
    </>
  )
}

// --- Regels Tab with inline edit ---

interface RegelRow {
  id: number
  artikelnr: string
  omschrijving: string | null
  omschrijving_2: string | null
  prijs: number
  gewicht: number | null
}

function RegelsTab({
  regels,
  zoek,
  setZoek,
  prijslijstNr,
}: {
  regels: RegelRow[]
  zoek: string
  setZoek: (v: string) => void
  prijslijstNr: string
}) {
  const filtered = useMemo(() => {
    if (!zoek) return regels
    const q = zoek.toLowerCase()
    return regels.filter(
      (r) =>
        r.artikelnr.includes(q) ||
        r.omschrijving?.toLowerCase().includes(q) ||
        r.omschrijving_2?.toLowerCase().includes(q),
    )
  }, [regels, zoek])

  return (
    <>
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-4">
        <span className="text-xs text-slate-400">{regels.length} artikelen</span>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Zoek op artikelnr of omschrijving..."
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-[var(--radius-sm)] w-64 focus:outline-none focus:ring-1 focus:ring-terracotta-300 focus:border-terracotta-300"
          />
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
            <th className="px-5 py-2 font-medium">Artikelnr</th>
            <th className="px-5 py-2 font-medium">Omschrijving</th>
            <th className="px-5 py-2 font-medium">Omschrijving 2</th>
            <th className="px-5 py-2 font-medium text-right">Prijs</th>
            <th className="px-5 py-2 font-medium text-right">Gewicht</th>
            <th className="px-5 py-2 font-medium w-16"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {filtered.slice(0, 200).map((r) => (
            <EditableRow key={r.id} regel={r} prijslijstNr={prijslijstNr} />
          ))}
        </tbody>
      </table>
      {filtered.length > 200 && (
        <div className="px-5 py-3 text-xs text-slate-400 border-t border-slate-100">
          {filtered.length - 200} artikelen niet getoond. Gebruik de zoekbalk om te filteren.
        </div>
      )}
      {filtered.length === 0 && (
        <div className="px-5 py-8 text-center text-sm text-slate-400">
          Geen artikelen gevonden
        </div>
      )}
    </>
  )
}

function EditableRow({ regel, prijslijstNr }: { regel: RegelRow; prijslijstNr: string }) {
  const [editing, setEditing] = useState(false)
  const [editPrijs, setEditPrijs] = useState('')
  const mutation = useUpdatePrijsRegel(prijslijstNr)

  const startEdit = () => {
    setEditPrijs(regel.prijs.toFixed(2))
    setEditing(true)
  }

  const cancel = () => {
    setEditing(false)
  }

  const save = () => {
    const newPrijs = parseFloat(editPrijs.replace(',', '.'))
    if (isNaN(newPrijs) || newPrijs < 0) return
    mutation.mutate({ id: regel.id, prijs: newPrijs })
    setEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') cancel()
  }

  return (
    <tr className="hover:bg-slate-50 group">
      <td className="px-5 py-2 font-mono text-xs">{regel.artikelnr}</td>
      <td className="px-5 py-2">{regel.omschrijving ?? '—'}</td>
      <td className="px-5 py-2 text-slate-500">{regel.omschrijving_2 ?? '—'}</td>
      <td className="px-5 py-2 text-right">
        {editing ? (
          <input
            type="text"
            value={editPrijs}
            onChange={(e) => setEditPrijs(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            className="w-24 px-2 py-1 text-right text-sm border border-terracotta-300 rounded-[var(--radius-sm)] focus:outline-none focus:ring-1 focus:ring-terracotta-300"
          />
        ) : (
          <span className="font-medium">{formatCurrency(regel.prijs)}</span>
        )}
      </td>
      <td className="px-5 py-2 text-right text-slate-500">
        {regel.gewicht != null ? `${regel.gewicht} kg` : '—'}
      </td>
      <td className="px-5 py-2 text-right">
        {editing ? (
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={save}
              className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
              title="Opslaan"
            >
              <Check size={14} />
            </button>
            <button
              onClick={cancel}
              className="p-1 text-slate-400 hover:bg-slate-100 rounded"
              title="Annuleren"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={startEdit}
            className="p-1 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-terracotta-500 hover:bg-slate-100 rounded transition-opacity"
            title="Prijs bewerken"
          >
            <Pencil size={14} />
          </button>
        )}
      </td>
    </tr>
  )
}

// --- Klanten Tab ---

function KlantenTab({
  klanten,
}: {
  klanten: { debiteur_nr: number; naam: string; status: string; plaats: string | null }[]
}) {
  if (klanten.length === 0) {
    return <div className="p-5 text-sm text-slate-400">Geen klanten gekoppeld aan deze prijslijst</div>
  }

  return (
    <>
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <Users size={14} className="text-slate-400" />
        <span className="text-xs text-slate-400">
          {klanten.length} klant{klanten.length !== 1 ? 'en' : ''} gebruiken deze prijslijst
        </span>
      </div>
      <div className="divide-y divide-slate-50">
        {klanten.map((k) => (
          <Link
            key={k.debiteur_nr}
            to={`/klanten/${k.debiteur_nr}`}
            className="flex items-center justify-between px-5 py-3 text-sm hover:bg-slate-50"
          >
            <div>
              <span className="font-medium text-slate-900">{k.naam}</span>
              <span className="text-slate-400 ml-2">#{k.debiteur_nr}</span>
            </div>
            <div className="flex items-center gap-3">
              {k.plaats && <span className="text-slate-400 text-xs">{k.plaats}</span>}
              <StatusBadge status={k.status} type="order" />
            </div>
          </Link>
        ))}
      </div>
    </>
  )
}
