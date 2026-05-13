import { useState, useMemo, useEffect } from 'react'
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Search, Pencil, Check, X, Users, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { InfoField } from '@/components/ui/info-field'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency } from '@/lib/utils/formatters'
import {
  usePrijslijstDetail,
  usePrijslijstRegels,
  usePrijslijstKlanten,
  useUpdatePrijsRegel,
  useRemovePrijslijstRegel,
  useDeletePrijslijst,
} from '@/hooks/use-prijslijsten'
import { useSetKlantPrijslijst } from '@/modules/debiteuren'
import { PrijslijstAddKlantDialog } from '@/components/prijslijsten/prijslijst-add-klant-dialog'
import { PrijslijstAddProductDialog } from '@/components/prijslijsten/prijslijst-add-product-dialog'

type Tab = 'regels' | 'klanten'

export function PrijslijstDetailPage() {
  const { nr } = useParams<{ nr: string }>()
  const prijslijstNr = nr ?? ''

  const { data: header, isLoading } = usePrijslijstDetail(prijslijstNr)
  const { data: regels } = usePrijslijstRegels(prijslijstNr)
  const { data: klanten } = usePrijslijstKlanten(prijslijstNr)

  const [activeTab, setActiveTab] = useState<Tab>('regels')
  const [zoek, setZoek] = useState('')
  const [showAddKlant, setShowAddKlant] = useState(false)
  const [showAddProduct, setShowAddProduct] = useState(false)

  const navigate = useNavigate()
  const deleteMutation = useDeletePrijslijst()

  // Open product-dialog automatisch als overzichtspagina hier landt na "Nieuwe prijslijst".
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (searchParams.get('addProduct') === '1') {
      setShowAddProduct(true)
      const next = new URLSearchParams(searchParams)
      next.delete('addProduct')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

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
        <div className="flex items-start justify-between gap-4 mb-1">
          <h1 className="text-xl font-semibold text-slate-900">{header.naam}</h1>
          <button
            onClick={async () => {
              const aantalKlanten = klanten?.length ?? 0
              const aantalRegels = regels?.length ?? 0
              if (aantalKlanten > 0) {
                alert(
                  `Kan deze prijslijst niet verwijderen: er ${
                    aantalKlanten === 1 ? 'is nog 1 klant gekoppeld' : `zijn nog ${aantalKlanten} klanten gekoppeld`
                  }. Koppel die eerst los via de Klanten-tab.`,
                )
                return
              }
              const ok = confirm(
                `"${header.naam}" definitief verwijderen?\n\n` +
                  `${aantalRegels} regel${aantalRegels === 1 ? '' : 's'} word${
                    aantalRegels === 1 ? 't' : 'en'
                  } ook verwijderd. Dit kan niet ongedaan gemaakt worden.`,
              )
              if (!ok) return
              try {
                await deleteMutation.mutateAsync(prijslijstNr)
                navigate('/prijslijsten', { replace: true })
              } catch (err) {
                alert(
                  'Verwijderen mislukt: ' +
                    (err instanceof Error ? err.message : 'onbekende fout'),
                )
              }
            }}
            disabled={deleteMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-[var(--radius-sm)] border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
            title="Prijslijst verwijderen"
          >
            <Trash2 size={14} />
            Verwijderen
          </button>
        </div>
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
          <RegelsTab
            regels={regels ?? []}
            zoek={zoek}
            setZoek={setZoek}
            prijslijstNr={prijslijstNr}
            onAddProduct={() => setShowAddProduct(true)}
          />
        )}
        {activeTab === 'klanten' && (
          <KlantenTab
            klanten={klanten ?? []}
            prijslijstNr={prijslijstNr}
            onAdd={() => setShowAddKlant(true)}
          />
        )}
      </div>

      {showAddKlant && (
        <PrijslijstAddKlantDialog
          prijslijstNr={prijslijstNr}
          prijslijstNaam={header.naam}
          onClose={() => setShowAddKlant(false)}
        />
      )}

      {showAddProduct && (
        <PrijslijstAddProductDialog
          prijslijstNr={prijslijstNr}
          prijslijstNaam={header.naam}
          onClose={() => setShowAddProduct(false)}
        />
      )}
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
  producten:
    | { gewicht_kg: number | null; kwaliteiten: { gewicht_per_m2_kg: number | null } | null }
    | null
}

function RegelsTab({
  regels,
  zoek,
  setZoek,
  prijslijstNr,
  onAddProduct,
}: {
  regels: RegelRow[]
  zoek: string
  setZoek: (v: string) => void
  prijslijstNr: string
  onAddProduct: () => void
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
        <div className="flex items-center gap-3">
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
          <button
            onClick={onAddProduct}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600"
          >
            <Plus size={14} />
            Product toevoegen
          </button>
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
            <th className="px-5 py-2 font-medium w-24"></th>
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
  const removeMutation = useRemovePrijslijstRegel(prijslijstNr)

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

  const handleRemove = () => {
    if (!confirm(`"${regel.artikelnr}" verwijderen uit deze prijslijst?`)) return
    removeMutation.mutate(regel.id)
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
        {(() => {
          // Voor rol/maatwerk-producten zonder eigen `gewicht_kg` valt de
          // weergave terug op de kwaliteit-density (kg/m²) — zelfde bron als
          // wat we bij toevoegen wegschrijven naar `prijslijst_regels.gewicht`.
          const w =
            regel.producten?.gewicht_kg
            ?? regel.gewicht
            ?? regel.producten?.kwaliteiten?.gewicht_per_m2_kg
          return w != null ? `${w} kg` : '—'
        })()}
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
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={startEdit}
              className="p-1 text-slate-300 hover:text-terracotta-500 hover:bg-slate-100 rounded"
              title="Prijs bewerken"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={handleRemove}
              disabled={removeMutation.isPending}
              className="p-1 text-slate-300 hover:!text-rose-600 hover:bg-rose-50 rounded disabled:opacity-40"
              title="Uit prijslijst verwijderen"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

// --- Klanten Tab ---

function KlantenTab({
  klanten,
  prijslijstNr,
  onAdd,
}: {
  klanten: { debiteur_nr: number; naam: string; status: string; plaats: string | null }[]
  prijslijstNr: string
  onAdd: () => void
}) {
  const [removeBusy, setRemoveBusy] = useState<number | null>(null)
  const [zoek, setZoek] = useState('')
  const setMutation = useSetKlantPrijslijst()

  const handleRemove = async (debiteurNr: number, naam: string) => {
    if (!confirm(`"${naam}" loskoppelen van deze prijslijst?`)) return
    setRemoveBusy(debiteurNr)
    try {
      await setMutation.mutateAsync({ debiteurNr, prijslijstNr: null })
    } finally {
      setRemoveBusy(null)
    }
  }

  const filtered = useMemo(() => {
    if (!zoek.trim()) return klanten
    const q = zoek.trim().toLowerCase()
    return klanten.filter(
      (k) =>
        k.naam.toLowerCase().includes(q) ||
        String(k.debiteur_nr).includes(q) ||
        k.plaats?.toLowerCase().includes(q),
    )
  }, [klanten, zoek])

  return (
    <>
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Users size={14} className="text-slate-400" />
          <span className="text-xs text-slate-400">
            {zoek.trim()
              ? `${filtered.length} van ${klanten.length} klant${klanten.length !== 1 ? 'en' : ''}`
              : `${klanten.length} klant${klanten.length !== 1 ? 'en' : ''} gebruik${klanten.length === 1 ? 't' : 'en'} deze prijslijst`}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Zoek op naam, debiteur-nr of plaats..."
              value={zoek}
              onChange={(e) => setZoek(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-[var(--radius-sm)] w-64 focus:outline-none focus:ring-1 focus:ring-terracotta-300 focus:border-terracotta-300"
            />
          </div>
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600"
          >
            <Plus size={14} />
            Klant toevoegen
          </button>
        </div>
      </div>

      {klanten.length === 0 ? (
        <div className="p-5 text-sm text-slate-400">
          Nog geen klanten op prijslijst {prijslijstNr}
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-slate-400">
          Geen klanten gevonden voor "{zoek}"
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {filtered.map((k) => (
            <div
              key={k.debiteur_nr}
              className="group flex items-center justify-between px-5 py-3 text-sm hover:bg-slate-50"
            >
              <Link
                to={`/klanten/${k.debiteur_nr}`}
                className="flex-1 min-w-0"
              >
                <span className="font-medium text-slate-900 hover:text-terracotta-600">
                  {k.naam}
                </span>
                <span className="text-slate-400 ml-2">#{k.debiteur_nr}</span>
              </Link>
              <div className="flex items-center gap-3">
                {k.plaats && <span className="text-slate-400 text-xs">{k.plaats}</span>}
                <StatusBadge status={k.status} type="order" />
                <button
                  onClick={() => handleRemove(k.debiteur_nr, k.naam)}
                  disabled={removeBusy === k.debiteur_nr}
                  title="Klant loskoppelen van deze prijslijst"
                  className="p-1 text-slate-300 group-hover:text-slate-500 hover:!text-rose-600 hover:bg-rose-50 rounded disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
