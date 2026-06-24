import { useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, X, Trash2, Upload } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { PageHeader } from '@/components/layout/page-header'
import { InfoField } from '@/components/ui/info-field'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency } from '@/lib/utils/formatters'
import { useDebiteurDetail, useAfleveradressen } from '../hooks/use-debiteuren'
import { useOrders } from '@/hooks/use-orders'
import { useAuth } from '@/hooks/use-auth'
import { KlanteigenNamenTab } from '../components/klanteigen-namen-tab'
import { KlantArtikelnummersTab } from '../components/klant-artikelnummers-tab'
import { KlantPrijslijstTab } from '../components/klant-prijslijst-tab'
import { KlantPrijslijstSelector } from '../components/klant-prijslijst-selector'
import { KlantVertegSelector } from '../components/klant-verteg-selector'
import { KlantFactureringTab } from '../components/klant-facturering-tab'
import { DebiteurEditDialog } from '../components/debiteur-edit-dialog'
import { AfleveradressenTab } from '../components/afleveradressen-tab'
import { EdiTag, KlantEdiTab } from '@/modules/edi'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

type Tab = 'info' | 'adressen' | 'orders' | 'facturering' | 'eigennamen' | 'artikelnummers' | 'prijslijst' | 'edi'

const TABS: { key: Tab; label: string }[] = [
  { key: 'info', label: 'Info' },
  { key: 'adressen', label: 'Afleveradressen' },
  { key: 'orders', label: 'Orders' },
  { key: 'facturering', label: 'Facturering' },
  { key: 'eigennamen', label: 'Klanteigen namen' },
  { key: 'artikelnummers', label: 'Artikelnummers' },
  { key: 'prijslijst', label: 'Prijslijst' },
  { key: 'edi', label: 'EDI' },
]

export function DebiteurDetailPage() {
  const { id } = useParams<{ id: string }>()
  const debiteurNr = Number(id)
  const navigate = useNavigate()
  // Externe vertegenwoordiger (mig 489): read-only. Alle muteer-affordances
  // worden verborgen — primaire knoppen (bewerken/verwijderen/logo) én de
  // inline-instellingen (afleverwijze/verzending/leveringen/lever-type).
  // RLS op `debiteuren` blijft de fail-closed backstop.
  const { isExternRep } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('info')
  const [showLogo, setShowLogo] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [logoVersion, setLogoVersion] = useState(0)
  const logoInputRef = useRef<HTMLInputElement>(null)

  const queryClient = useQueryClient()
  const { data: klant, isLoading } = useDebiteurDetail(debiteurNr)
  const { data: adressen } = useAfleveradressen(debiteurNr)
  const { data: ordersData } = useOrders({ debiteurNr, pageSize: 1000 })

  const [editVerzendkosten, setEditVerzendkosten] = useState(false)
  const [editVerzendDrempel, setEditVerzendDrempel] = useState(false)
  const [editStandaardDagen, setEditStandaardDagen] = useState(false)
  const [editMaatwerkWeken, setEditMaatwerkWeken] = useState(false)

  const showError = (label: string) => (err: unknown) => {
    console.error(`[${label}]`, err)
    const e = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown } | null
    const parts = [
      typeof e?.message === 'string' ? e.message : null,
      typeof e?.details === 'string' ? `details: ${e.details}` : null,
      typeof e?.hint === 'string' ? `hint: ${e.hint}` : null,
      typeof e?.code === 'string' ? `code: ${e.code}` : null,
    ].filter(Boolean)
    const msg = parts.length > 0 ? parts.join('\n') : 'onbekende fout (zie console)'
    alert(`${label} opslaan mislukt:\n${msg}`)
  }

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
    onError: showError('Gratis verzending'),
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
    onError: showError('Afleverwijze'),
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
    onError: showError('Verzendkosten'),
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
    onError: showError('Standaard-maat levertermijn'),
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
    onError: showError('Maatwerk levertermijn'),
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
    onError: showError('Deelleveringen'),
  })

  const leverTypeMutation = useMutation({
    mutationFn: async (nieuw: 'week' | 'datum') => {
      const { error } = await supabase
        .from('debiteuren')
        .update({ default_lever_type: nieuw })
        .eq('debiteur_nr', debiteurNr)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['klanten', debiteurNr] })
    },
    onError: showError('Standaard lever-type'),
  })

  const tapijtStickerMutation = useMutation({
    mutationFn: async (newValue: boolean) => {
      const { error } = await supabase
        .from('debiteuren')
        .update({ tapijt_sticker_bij_standaard: newValue })
        .eq('debiteur_nr', debiteurNr)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['klanten', debiteurNr] })
    },
    onError: showError('Tapijt-stickers bij standaard'),
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
    onError: showError('Drempel gratis verzending'),
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      // Check op bestaande orders
      const { count, error: cntErr } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('debiteur_nr', debiteurNr)
      if (cntErr) throw cntErr
      if ((count ?? 0) > 0) {
        throw new Error(
          `Deze klant heeft ${count} order(s) en kan niet worden verwijderd. Annuleer of verwijder eerst alle orders.`,
        )
      }

      const { error } = await supabase
        .from('debiteuren')
        .delete()
        .eq('debiteur_nr', debiteurNr)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['klanten'] })
      navigate('/klanten')
    },
    onError: (err: unknown) => {
      const e = err as { message?: unknown } | null
      setDeleteError(typeof e?.message === 'string' ? e.message : 'Onbekende fout — zie console')
    },
  })

  const logoUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const path = `${debiteurNr}.jpg`
      const { error: uploadError } = await supabase.storage
        .from('logos')
        .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' })
      if (uploadError) throw uploadError
      const { error: dbError } = await supabase
        .from('debiteuren')
        .update({ logo_path: path })
        .eq('debiteur_nr', debiteurNr)
      if (dbError) throw dbError
    },
    onSuccess: () => {
      setLogoVersion(Date.now())
      queryClient.invalidateQueries({ queryKey: ['klanten'] })
    },
    onError: showError('Logo uploaden'),
  })

  const logoDeleteMutation = useMutation({
    mutationFn: async () => {
      const path = `${debiteurNr}.jpg`
      const { error: removeError } = await supabase.storage.from('logos').remove([path])
      if (removeError) throw removeError
      const { error: dbError } = await supabase
        .from('debiteuren')
        .update({ logo_path: null })
        .eq('debiteur_nr', debiteurNr)
      if (dbError) throw dbError
    },
    onSuccess: () => {
      setShowLogo(false)
      queryClient.invalidateQueries({ queryKey: ['klanten'] })
    },
    onError: showError('Logo verwijderen'),
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
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} />
          Terug naar klanten
        </button>
      </div>

      {/* Header card */}
      <div className="relative bg-white rounded-[var(--radius)] border border-slate-200 p-6 mb-6">
        {!isExternRep && (
        <div className="absolute top-4 right-4 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowEdit(true)}
            aria-label="Klantgegevens bewerken"
            title="Klantgegevens bewerken"
            className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] text-slate-400 hover:text-terracotta-600 hover:bg-terracotta-50 transition-colors"
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            onClick={() => { setDeleteError(null); setShowDelete(true) }}
            aria-label="Klant verwijderen"
            title="Klant verwijderen"
            className="inline-flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
          >
            <Trash2 size={16} />
          </button>
        </div>
        )}
        <div className="flex items-start gap-4 mb-4">
          {/* Logo / initialen */}
          <div className="relative group w-16 h-16 shrink-0">
            {klant.logo_path ? (
              <button onClick={() => setShowLogo(true)} className="cursor-zoom-in block w-full h-full">
                <img
                  src={`${SUPABASE_URL}/storage/v1/object/public/logos/${klant.debiteur_nr}.jpg${logoVersion ? `?v=${logoVersion}` : ''}`}
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

            {!isExternRep && (
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) logoUploadMutation.mutate(file)
                e.target.value = ''
              }}
            />
            )}
            {!isExternRep && (
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              disabled={logoUploadMutation.isPending}
              aria-label="Logo uploaden"
              title="Logo uploaden"
              className="absolute -bottom-1.5 -right-1.5 w-6 h-6 flex items-center justify-center rounded-full bg-white border border-slate-200 shadow-sm text-slate-400 opacity-0 group-hover:opacity-100 hover:text-terracotta-600 hover:bg-terracotta-50 transition-opacity disabled:opacity-50"
            >
              <Upload size={12} />
            </button>
            )}
            {!isExternRep && klant.logo_path && (
              <button
                type="button"
                onClick={() => {
                  if (confirm('Logo verwijderen voor deze klant?')) logoDeleteMutation.mutate()
                }}
                disabled={logoDeleteMutation.isPending}
                aria-label="Logo verwijderen"
                title="Logo verwijderen"
                className="absolute -top-1.5 -right-1.5 w-6 h-6 flex items-center justify-center rounded-full bg-white border border-slate-200 shadow-sm text-slate-400 opacity-0 group-hover:opacity-100 hover:text-rose-600 hover:bg-rose-50 transition-opacity disabled:opacity-50"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex-1">
            <h1 className="text-xl font-semibold text-slate-900 mb-1">{klant.naam}</h1>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-400">#{klant.debiteur_nr}</span>
              <StatusBadge status={klant.status} type="order" />
              <StatusBadge status={klant.tier} type="tier" />
              {klant.edi_actief && <EdiTag testModus={klant.edi_test_modus} />}
              <KlantVertegSelector
                debiteurNr={debiteurNr}
                vertegCode={klant.vertegenw_code}
                vertegNaam={klant.vertegenwoordiger_naam ?? null}
                variant="header"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <InfoField label="Adres" value={[klant.adres, `${klant.postcode ?? ''} ${klant.plaats ?? ''}`.trim()].filter(Boolean).join(', ')} />
          <InfoField label="Telefoon" value={klant.telefoon} />
          <InfoField label="Email" value={klant.email_factuur} />
          <InfoField label="BTW" value={klant.btw_nummer} />
        </div>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
          <KlantPrijslijstSelector
            debiteurNr={debiteurNr}
            prijslijstNr={klant.prijslijst_nr}
            prijslijstNaam={klant.prijslijst_naam ?? null}
          />
          <div>
            <div className="text-xs text-slate-400 mb-1">Inkoopgroep</div>
            {klant.inkoopgroep_code ? (
              <Link
                to={`/inkoopgroepen/${klant.inkoopgroep_code}`}
                className="text-terracotta-500 hover:underline font-medium"
              >
                {klant.inkoopgroep_naam ?? klant.inkoopgroep_code}
              </Link>
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </div>
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
            {isExternRep ? (
              <span className="text-slate-700">{klant.afleverwijze ?? 'Bezorgen'}</span>
            ) : (
              <select
                value={klant.afleverwijze ?? 'Bezorgen'}
                onChange={(e) => afleverwijzeMutation.mutate(e.target.value)}
                disabled={afleverwijzeMutation.isPending}
                className="w-full px-2 py-1 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400 disabled:opacity-50"
              >
                <option value="Bezorgen">Bezorgen</option>
                <option value="Afhalen">Afhalen</option>
              </select>
            )}
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
              {!isExternRep && (
                <button
                  onClick={() => gratisVerzendingMutation.mutate(!klant.gratis_verzending)}
                  disabled={gratisVerzendingMutation.isPending}
                  className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium disabled:opacity-50"
                >
                  {gratisVerzendingMutation.isPending ? '...' : 'Wijzig'}
                </button>
              )}
            </div>
          </div>

          {/* Verzendkosten */}
          <div>
            <div className="text-xs text-slate-400 mb-1">Verzendkosten</div>
            {klant.gratis_verzending ? (
              <span className="text-slate-400 italic">n.v.t.</span>
            ) : editVerzendkosten && !isExternRep ? (
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
                {!isExternRep && (
                  <button onClick={() => setEditVerzendkosten(true)} className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium">
                    Wijzig
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Drempel gratis verzending */}
          <div>
            <div className="text-xs text-slate-400 mb-1">Drempel gratis verzending</div>
            {klant.gratis_verzending ? (
              <span className="text-slate-400 italic">n.v.t.</span>
            ) : editVerzendDrempel && !isExternRep ? (
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
                {!isExternRep && (
                  <button onClick={() => setEditVerzendDrempel(true)} className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium">
                    Wijzig
                  </button>
                )}
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
            {editStandaardDagen && !isExternRep ? (
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
                {!isExternRep && (
                  <button onClick={() => setEditStandaardDagen(true)} className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium">
                    Wijzig
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Maatwerk levertermijn */}
          <div>
            <div className="text-xs text-slate-400 mb-1">Maatwerk levertermijn</div>
            {editMaatwerkWeken && !isExternRep ? (
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
                {!isExternRep && (
                  <button onClick={() => setEditMaatwerkWeken(true)} className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium">
                    Wijzig
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Deelleveringen (toggle) */}
          <div>
            <div className="text-xs text-slate-400 mb-1">Deelleveringen</div>
            <div className="flex items-center gap-3">
              {!isExternRep && (
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
              )}
              <span className="text-slate-700">
                {klant.deelleveringen_toegestaan ? 'Aan' : 'Uit'}
              </span>
            </div>
          </div>

          {/* Tapijt-stickers bij standaard (toggle) — mig 303 */}
          <div>
            <div className="text-xs text-slate-400 mb-1">Tapijt-stickers bij standaard</div>
            <div className="flex items-center gap-3">
              {!isExternRep && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={klant.tapijt_sticker_bij_standaard}
                  onClick={() => tapijtStickerMutation.mutate(!klant.tapijt_sticker_bij_standaard)}
                  disabled={tapijtStickerMutation.isPending}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 disabled:opacity-50 ${
                    klant.tapijt_sticker_bij_standaard ? 'bg-terracotta-500' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      klant.tapijt_sticker_bij_standaard ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              )}
              <span className="text-slate-700">
                {klant.tapijt_sticker_bij_standaard ? 'Aan' : 'Uit'}
              </span>
            </div>
          </div>

          {/* Standaard lever-type (segmented) — ADR 0014 / mig 244 */}
          <div>
            <div className="text-xs text-slate-400 mb-1">Standaard levering</div>
            {isExternRep ? (
              <span className="text-slate-700">
                {klant.default_lever_type === 'datum' ? 'Op datum' : 'Per week'}
              </span>
            ) : (
              <div className="inline-flex items-center gap-1 p-0.5 bg-slate-100 rounded-[var(--radius-sm)]">
                <button
                  type="button"
                  onClick={() => leverTypeMutation.mutate('week')}
                  disabled={leverTypeMutation.isPending || klant.default_lever_type === 'week'}
                  className={`px-3 py-1 text-xs font-medium rounded-[calc(var(--radius-sm)-2px)] transition disabled:cursor-default ${
                    klant.default_lever_type === 'week'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Per week
                </button>
                <button
                  type="button"
                  onClick={() => leverTypeMutation.mutate('datum')}
                  disabled={leverTypeMutation.isPending || klant.default_lever_type === 'datum'}
                  className={`px-3 py-1 text-xs font-medium rounded-[calc(var(--radius-sm)-2px)] transition disabled:cursor-default ${
                    klant.default_lever_type === 'datum'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Op datum
                </button>
              </div>
            )}
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
        {activeTab === 'adressen' && <AfleveradressenTab debiteurNr={debiteurNr} adressen={adressen} />}
        {activeTab === 'orders' && <OrdersTab orders={ordersData?.orders} totalCount={ordersData?.totalCount} />}
        {activeTab === 'facturering' && klant && (
          <KlantFactureringTab
            debiteurNr={debiteurNr}
            btwNummer={klant.btw_nummer}
          />
        )}
        {activeTab === 'eigennamen' && <KlanteigenNamenTab debiteurNr={debiteurNr} />}
        {activeTab === 'artikelnummers' && <KlantArtikelnummersTab debiteurNr={debiteurNr} />}
        {activeTab === 'prijslijst' && <KlantPrijslijstTab debiteurNr={debiteurNr} />}
        {activeTab === 'edi' && <KlantEdiTab debiteurNr={debiteurNr} />}
      </div>

      {/* Klant bewerken modal */}
      {showEdit && klant && (
        <DebiteurEditDialog debiteur={klant} onClose={() => setShowEdit(false)} />
      )}

      {/* Klant verwijderen — bevestigingsdialoog */}
      {showDelete && klant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-md">
            <header className="px-6 py-4 border-b border-slate-200">
              <h2 className="font-medium text-lg">Klant verwijderen</h2>
            </header>
            <div className="px-6 py-5 space-y-3">
              <p className="text-sm text-slate-700">
                Weet je zeker dat je <strong>{klant.naam}</strong> (#{klant.debiteur_nr}) wilt verwijderen?
                Dit kan niet ongedaan worden gemaakt.
              </p>
              {deleteError && (
                <div className="px-3 py-2 bg-rose-50 border border-rose-100 text-sm text-rose-700 rounded-[var(--radius-sm)]">
                  {deleteError}
                </div>
              )}
            </div>
            <footer className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowDelete(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
              >
                Annuleren
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-rose-600 text-white font-medium hover:bg-rose-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Verwijderen...' : 'Definitief verwijderen'}
              </button>
            </footer>
          </div>
        </div>
      )}

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
              src={`${SUPABASE_URL}/storage/v1/object/public/logos/${klant.debiteur_nr}.jpg${logoVersion ? `?v=${logoVersion}` : ''}`}
              alt={klant.naam}
              className="max-w-full max-h-[75vh] object-contain"
            />
          </div>
        </div>
      )}
    </>
  )
}

function InfoTab({ klant }: { klant: NonNullable<ReturnType<typeof useDebiteurDetail>['data']> }) {
  return (
    <div className="p-5 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
      <KlantVertegSelector
        debiteurNr={klant.debiteur_nr}
        vertegCode={klant.vertegenw_code}
        vertegNaam={klant.vertegenwoordiger_naam ?? null}
        variant="info"
      />
      <div>
        <span className="text-slate-500">Inkoopgroep</span>
        <p className="font-medium">
          {klant.inkoopgroep_code ? (
            <Link
              to={`/inkoopgroepen/${klant.inkoopgroep_code}`}
              className="text-terracotta-500 hover:underline"
            >
              {klant.inkoopgroep_naam ?? klant.inkoopgroep_code}
            </Link>
          ) : (
            '—'
          )}
        </p>
      </div>
      <InfoField label="Route" value={klant.route} />
      <InfoField label="Rayon" value={klant.rayon_naam} />
      <InfoField label="Factuur naam" value={klant.fact_naam} />
      <InfoField label="Factuur adres" value={[klant.fact_adres, `${klant.fact_postcode ?? ''} ${klant.fact_plaats ?? ''}`.trim()].filter(Boolean).join(', ')} />
      <InfoField label="Email (overig)" value={klant.email_overig} />
      <InfoField label="Email verzending (T&T)" value={klant.email_verzend} />
      <InfoField label="Email 2" value={klant.email_2} />
      <InfoField label="Fax" value={klant.fax} />
      <InfoField label="GLN" value={klant.gln_bedrijf} />
      <InfoField label="Land" value={klant.land} />
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
