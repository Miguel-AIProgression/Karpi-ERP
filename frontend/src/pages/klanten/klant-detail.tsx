import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, X } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { PageHeader } from '@/components/layout/page-header'
import { InfoField } from '@/components/ui/info-field'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency } from '@/lib/utils/formatters'
import { useKlantDetail, useAfleveradressen } from '@/hooks/use-klanten'
import { useOrders } from '@/hooks/use-orders'
import { KlanteigenNamenTab } from '@/components/klanten/klanteigen-namen-tab'
import { KlantArtikelnummersTab } from '@/components/klanten/klant-artikelnummers-tab'
import { KlantPrijslijstTab } from '@/components/klanten/klant-prijslijst-tab'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

type Tab = 'info' | 'adressen' | 'orders' | 'eigennamen' | 'artikelnummers' | 'prijslijst'

const TABS: { key: Tab; label: string }[] = [
  { key: 'info', label: 'Info' },
  { key: 'adressen', label: 'Afleveradressen' },
  { key: 'orders', label: 'Orders' },
  { key: 'eigennamen', label: 'Klanteigen namen' },
  { key: 'artikelnummers', label: 'Artikelnummers' },
  { key: 'prijslijst', label: 'Prijslijst' },
]

export function KlantDetailPage() {
  const { id } = useParams<{ id: string }>()
  const debiteurNr = Number(id)
  const [activeTab, setActiveTab] = useState<Tab>('info')
  const [showLogo, setShowLogo] = useState(false)

  const queryClient = useQueryClient()
  const { data: klant, isLoading } = useKlantDetail(debiteurNr)
  const { data: adressen } = useAfleveradressen(debiteurNr)
  const { data: ordersData } = useOrders({ debiteurNr, pageSize: 1000 })

  const [editVerzendkosten, setEditVerzendkosten] = useState(false)
  const [editVerzendDrempel, setEditVerzendDrempel] = useState(false)
  const [editStandaardDagen, setEditStandaardDagen] = useState(false)
  const [editMaatwerkWeken, setEditMaatwerkWeken] = useState(false)

  const gratisVerzendingMutation = useMutation({
    mutationFn: async (newValue: boolean) => {
      const { error } = await supabase
        .from('debiteuren')
        .update({ gratis_verzending: newValue })
        .eq('debiteur_nr', debiteurNr)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['klanten', debiteurNr] })
    },
  })

  const afleverwijzeMutation = useMutation({
    mutationFn: async (newValue: string) => {
      const { error } = await supabase
        .from('debiteuren')
        .update({ afleverwijze: newValue })
        .eq('debiteur_nr', debiteurNr)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['klanten', debiteurNr] })
    },
  })

  const verzendkostenMutation = useMutation({
    mutationFn: async (newValue: number) => {
      const { error } = await supabase
        .from('debiteuren')
        .update({ verzendkosten: newValue })
        .eq('debiteur_nr', debiteurNr)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['klanten', debiteurNr] })
      setEditVerzendkosten(false)
    },
  })

  const standaardDagenMutation = useMutation({
    mutationFn: async (newValue: number | null) => {
      const { error } = await supabase
        .from('debiteuren')
        .update({ standaard_maat_werkdagen: newValue })
        .eq('debiteur_nr', debiteurNr)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['klanten', debiteurNr] })
      setEditStandaardDagen(false)
    },
  })

  const maatwerkWekenMutation = useMutation({
    mutationFn: async (newValue: number | null) => {
      const { error } = await supabase
        .from('debiteuren')
        .update({ maatwerk_weken: newValue })
        .eq('debiteur_nr', debiteurNr)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['klanten', debiteurNr] })
      setEditMaatwerkWeken(false)
    },
  })

  const deelleveringenMutation = useMutation({
    mutationFn: async (newValue: boolean) => {
      const { error } = await supabase
        .from('debiteuren')
        .update({ deelleveringen_toegestaan: newValue })
        .eq('debiteur_nr', debiteurNr)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['klanten', debiteurNr] })
    },
  })

  const verzendDrempelMutation = useMutation({
    mutationFn: async (newValue: number) => {
      const { error } = await supabase
        .from('debiteuren')
        .update({ verzend_drempel: newValue })
        .eq('debiteur_nr', debiteurNr)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['klanten', debiteurNr] })
      setEditVerzendDrempel(false)
    },
  })

  if (isLoading) {
    return <PageHeader title="Klant laden..." />
  }

  if (!klant) {
    return (
      <>
        <PageHeader title="Klant niet gevonden" />
        <Link to="/klanten" className="text-terracotta-500 hover:underline">
          Terug naar klanten
        </Link>
      </>
    )
  }

  return (
    <>
      <div className="mb-4">
        <Link
          to="/klanten"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} />
          Terug naar klanten
        </Link>
      </div>

      {/* Header card */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6 mb-6">
        <div className="flex items-start gap-4 mb-4">
          {/* Logo / initialen */}
          {klant.logo_path ? (
            <button onClick={() => setShowLogo(true)} className="cursor-zoom-in">
              <img
                src={`${SUPABASE_URL}/storage/v1/object/public/logos/${klant.debiteur_nr}.jpg`}
                alt={klant.naam}
                className="w-16 h-16 rounded-[var(--radius-sm)] object-contain bg-slate-50 border border-slate-100"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </button>
          ) : (
            <div className="w-16 h-16 rounded-[var(--radius-sm)] bg-slate-100 flex items-center justify-center text-lg font-medium text-slate-400">
              {klant.naam.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()}
            </div>
          )}

          <div className="flex-1">
            <h1 className="text-xl font-semibold text-slate-900 mb-1">{klant.naam}</h1>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-400">#{klant.debiteur_nr}</span>
              <StatusBadge status={klant.status} type="order" />
              <StatusBadge status={klant.tier} type="tier" />
              {klant.vertegenwoordiger_naam && (
                <span className="text-sm text-slate-500">
                  Verteg: <span className="font-medium text-slate-700">{klant.vertegenwoordiger_naam}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <InfoField label="Adres" value={[klant.adres, `${klant.postcode ?? ''} ${klant.plaats ?? ''}`.trim()].filter(Boolean).join(', ')} />
          <InfoField label="Telefoon" value={klant.telefoon} />
          <InfoField label="Email" value={klant.email_factuur} />
          <InfoField label="BTW" value={klant.btw_nummer} />
          <InfoField label="Prijslijst" value={klant.prijslijst_nr} />
          <InfoField label="Korting" value={klant.korting_pct ? `${klant.korting_pct}%` : null} />
          <InfoField label="Betaalconditie" value={klant.betaalconditie} />
          <InfoField label="Omzet YTD" value={formatCurrency(klant.omzet_ytd)} />
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100 space-y-5 text-sm">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Verzending</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4">
          {/* Afleverwijze */}
          <div>
            <div className="text-xs text-slate-400 mb-1">Afleverwijze</div>
            <select
              value={klant.afleverwijze ?? 'Bezorgen'}
              onChange={(e) => afleverwijzeMutation.mutate(e.target.value)}
              disabled={afleverwijzeMutation.isPending}
              className="w-full px-2 py-1 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400 disabled:opacity-50"
            >
              <option value="Bezorgen">Bezorgen</option>
              <option value="Afhalen">Afhalen</option>
            </select>
          </div>

          {/* Gratis verzending */}
          <div>
            <div className="text-xs text-slate-400 mb-1">Gratis verzending</div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                klant.gratis_verzending
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-500'
              }`}>
                {klant.gratis_verzending ? 'Ja' : 'Nee'}
              </span>
              <button
                onClick={() => gratisVerzendingMutation.mutate(!klant.gratis_verzending)}
                disabled={gratisVerzendingMutation.isPending}
                className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium disabled:opacity-50"
              >
                {gratisVerzendingMutation.isPending ? '...' : 'Wijzig'}
              </button>
            </div>
          </div>

          {/* Verzendkosten */}
          <div>
            <div className="text-xs text-slate-400 mb-1">Verzendkosten</div>
            {klant.gratis_verzending ? (
              <span className="text-slate-400 italic">n.v.t.</span>
            ) : editVerzendkosten ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const val = parseFloat((e.currentTarget.elements.namedItem('verzendkosten') as HTMLInputElement).value)
                  if (!isNaN(val) && val >= 0) verzendkostenMutation.mutate(val)
                }}
                className="flex items-center gap-1"
              >
                <span className="text-slate-500">€</span>
                <input
                  name="verzendkosten"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={klant.verzendkosten ?? 35}
                  autoFocus
                  className="w-16 px-1 py-0.5 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30"
                />
                <button type="submit" disabled={verzendkostenMutation.isPending} className="text-xs text-terracotta-500 font-medium disabled:opacity-50">
                  OK
                </button>
                <button type="button" onClick={() => setEditVerzendkosten(false)} className="text-xs text-slate-400 hover:text-slate-600">
                  ✕
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-slate-700">€ {(klant.verzendkosten ?? 35).toFixed(2).replace('.', ',')}</span>
                <button onClick={() => setEditVerzendkosten(true)} className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium">
                  Wijzig
                </button>
              </div>
            )}
          </div>

          {/* Drempel gratis verzending */}
          <div>
            <div className="text-xs text-slate-400 mb-1">Drempel gratis verzending</div>
            {klant.gratis_verzending ? (
              <span className="text-slate-400 italic">n.v.t.</span>
            ) : editVerzendDrempel ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const val = parseFloat((e.currentTarget.elements.namedItem('verzend_drempel') as HTMLInputElement).value)
                  if (!isNaN(val) && val >= 0) verzendDrempelMutation.mutate(val)
                }}
                className="flex items-center gap-1"
              >
                <span className="text-slate-500">€</span>
                <input
                  name="verzend_drempel"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={klant.verzend_drempel ?? 500}
                  autoFocus
                  className="w-20 px-1 py-0.5 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30"
                />
                <button type="submit" disabled={verzendDrempelMutation.isPending} className="text-xs text-terracotta-500 font-medium disabled:opacity-50">
                  OK
                </button>
                <button type="button" onClick={() => setEditVerzendDrempel(false)} className="text-xs text-slate-400 hover:text-slate-600">
                  ✕
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-slate-700">€ {(klant.verzend_drempel ?? 500).toFixed(0)}</span>
                <button onClick={() => setEditVerzendDrempel(true)} className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium">
                  Wijzig
                </button>
              </div>
            )}
          </div>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Leveringen</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
          {/* Standaard-maat levertermijn */}
          <div>
            <div className="text-xs text-slate-400 mb-1">Standaard-maat levertermijn</div>
            {editStandaardDagen ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const raw = (e.currentTarget.elements.namedItem('standaardDagen') as HTMLInputElement).value.trim()
                  if (raw === '') { standaardDagenMutation.mutate(null); return }
                  const val = parseInt(raw, 10)
                  if (!isNaN(val) && val >= 0) standaardDagenMutation.mutate(val)
                }}
                className="flex items-center gap-1"
              >
                <input
                  name="standaardDagen"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={klant.standaard_maat_werkdagen ?? ''}
                  placeholder="—"
                  autoFocus
                  className="w-14 px-1 py-0.5 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30"
                />
                <span className="text-slate-500 text-xs">dgn</span>
                <button type="submit" disabled={standaardDagenMutation.isPending} className="text-xs text-terracotta-500 font-medium disabled:opacity-50">OK</button>
                <button type="button" onClick={() => setEditStandaardDagen(false)} className="text-xs text-slate-400 hover:text-slate-600">✕</button>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-slate-700">
                  {klant.standaard_maat_werkdagen != null
                    ? `${klant.standaard_maat_werkdagen} ${klant.standaard_maat_werkdagen === 1 ? 'dag' : 'dagen'}`
                    : <span className="text-slate-400 italic">Standaard</span>}
                </span>
                <button onClick={() => setEditStandaardDagen(true)} className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium">
                  Wijzig
                </button>
              </div>
            )}
          </div>

          {/* Maatwerk levertermijn */}
          <div>
            <div className="text-xs text-slate-400 mb-1">Maatwerk levertermijn</div>
            {editMaatwerkWeken ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const raw = (e.currentTarget.elements.namedItem('maatwerkWeken') as HTMLInputElement).value.trim()
                  if (raw === '') { maatwerkWekenMutation.mutate(null); return }
                  const val = parseInt(raw, 10)
                  if (!isNaN(val) && val >= 0) maatwerkWekenMutation.mutate(val)
                }}
                className="flex items-center gap-1"
              >
                <input
                  name="maatwerkWeken"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={klant.maatwerk_weken ?? ''}
                  placeholder="—"
                  autoFocus
                  className="w-14 px-1 py-0.5 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30"
                />
                <span className="text-slate-500 text-xs">wkn</span>
                <button type="submit" disabled={maatwerkWekenMutation.isPending} className="text-xs text-terracotta-500 font-medium disabled:opacity-50">OK</button>
                <button type="button" onClick={() => setEditMaatwerkWeken(false)} className="text-xs text-slate-400 hover:text-slate-600">✕</button>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-slate-700">
                  {klant.maatwerk_weken != null
                    ? `${klant.maatwerk_weken} ${klant.maatwerk_weken === 1 ? 'week' : 'weken'}`
                    : <span className="text-slate-400 italic">Standaard</span>}
                </span>
                <button onClick={() => setEditMaatwerkWeken(true)} className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium">
                  Wijzig
                </button>
              </div>
            )}
          </div>

          {/* Deelleveringen (toggle) */}
          <div>
            <div className="text-xs text-slate-400 mb-1">Deelleveringen</div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={klant.deelleveringen_toegestaan}
                onClick={() => deelleveringenMutation.mutate(!klant.deelleveringen_toegestaan)}
                disabled={deelleveringenMutation.isPending}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 disabled:opacity-50 ${
                  klant.deelleveringen_toegestaan ? 'bg-terracotta-500' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    klant.deelleveringen_toegestaan ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
              <span className="text-slate-700">
                {klant.deelleveringen_toegestaan ? 'Aan' : 'Uit'}
              </span>
            </div>
          </div>
          </div>
        </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 mb-4">
        <nav className="flex gap-1 -mb-px">
          {TABS.map((tab) => (
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

      {/* Tab content */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200">
        {activeTab === 'info' && <InfoTab klant={klant} />}
        {activeTab === 'adressen' && <AdressenTab adressen={adressen} />}
        {activeTab === 'orders' && <OrdersTab orders={ordersData?.orders} totalCount={ordersData?.totalCount} />}
        {activeTab === 'eigennamen' && <KlanteigenNamenTab debiteurNr={debiteurNr} />}
        {activeTab === 'artikelnummers' && <KlantArtikelnummersTab debiteurNr={debiteurNr} />}
        {activeTab === 'prijslijst' && <KlantPrijslijstTab debiteurNr={debiteurNr} />}
      </div>

      {/* Logo lightbox */}
      {showLogo && klant.logo_path && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowLogo(false)}
        >
          <div className="relative max-w-lg max-h-[80vh] p-2 bg-white rounded-[var(--radius)] shadow-xl">
            <button
              onClick={() => setShowLogo(false)}
              className="absolute -top-3 -right-3 w-8 h-8 flex items-center justify-center rounded-full bg-white shadow-md text-slate-500 hover:text-slate-700"
            >
              <X size={16} />
            </button>
            <img
              src={`${SUPABASE_URL}/storage/v1/object/public/logos/${klant.debiteur_nr}.jpg`}
              alt={klant.naam}
              className="max-w-full max-h-[75vh] object-contain"
            />
          </div>
        </div>
      )}
    </>
  )
}

function InfoTab({ klant }: { klant: NonNullable<ReturnType<typeof useKlantDetail>['data']> }) {
  return (
    <div className="p-5 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
      <InfoField label="Vertegenwoordiger" value={klant.vertegenwoordiger_naam ?? klant.vertegenw_code} />
      <InfoField label="Route" value={klant.route} />
      <InfoField label="Rayon" value={klant.rayon_naam} />
      <InfoField label="Factuur naam" value={klant.fact_naam} />
      <InfoField label="Factuur adres" value={[klant.fact_adres, `${klant.fact_postcode ?? ''} ${klant.fact_plaats ?? ''}`.trim()].filter(Boolean).join(', ')} />
      <InfoField label="Email (overig)" value={klant.email_overig} />
      <InfoField label="Email 2" value={klant.email_2} />
      <InfoField label="Fax" value={klant.fax} />
      <InfoField label="GLN" value={klant.gln_bedrijf} />
      <InfoField label="Land" value={klant.land} />
    </div>
  )
}

function AdressenTab({ adressen }: { adressen?: { id: number; adres_nr: number; naam: string | null; adres: string | null; postcode: string | null; plaats: string | null }[] }) {
  if (!adressen || adressen.length === 0) {
    return <div className="p-5 text-sm text-slate-400">Geen afleveradressen</div>
  }
  return (
    <div className="divide-y divide-slate-50">
      {adressen.map((a) => (
        <div key={a.id} className="px-5 py-3 text-sm">
          <span className="text-slate-400 mr-2">#{a.adres_nr}</span>
          <span className="font-medium">{a.naam}</span>
          {a.adres && <span className="text-slate-500"> — {a.adres}, {a.postcode} {a.plaats}</span>}
        </div>
      ))}
    </div>
  )
}

function OrdersTab({ orders, totalCount }: { orders?: { id: number; order_nr: string; totaal_bedrag: number; status: string }[]; totalCount?: number }) {
  const PAGE_SIZE = 20
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  if (!orders || orders.length === 0) {
    return <div className="p-5 text-sm text-slate-400">Nog geen orders</div>
  }

  const total = totalCount ?? orders.length
  const shown = Math.min(visibleCount, orders.length)

  return (
    <>
      <div className="px-5 py-3 border-b border-slate-100 text-xs text-slate-400">
        {total} orders totaal
      </div>
      <div className="divide-y divide-slate-50">
        {orders.slice(0, shown).map((o) => (
          <Link
            key={o.id}
            to={`/orders/${o.id}`}
            className="flex items-center justify-between px-5 py-3 text-sm hover:bg-slate-50"
          >
            <span className="text-terracotta-500 font-medium">{o.order_nr}</span>
            <span className="text-slate-500">{formatCurrency(o.totaal_bedrag)}</span>
            <StatusBadge status={o.status} />
          </Link>
        ))}
      </div>
      {shown < orders.length && (
        <button
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          className="w-full py-3 text-sm text-terracotta-500 hover:bg-slate-50 border-t border-slate-100"
        >
          Meer laden ({orders.length - shown} resterend)
        </button>
      )}
    </>
  )
}
