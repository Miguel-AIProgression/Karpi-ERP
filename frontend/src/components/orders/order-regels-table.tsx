import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Scissors, ArrowRight, Pencil, X, Check, PackageCheck } from 'lucide-react'
import { DeelzendingDialog } from '@/components/orders/deelzending-dialog'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { formatCurrency, formatDate } from '@/lib/utils/formatters'
import { snijplanBadgeClass, AFWERKING_MAP } from '@/lib/utils/constants'
import { getVormDisplay } from '@/lib/utils/vorm-labels'
import { isoWeekFromString, isoWeekString, isoWeekStringVanIso } from '@/lib/utils/iso-week'
import type { OrderRegel } from '@/lib/supabase/queries/orders'
import { setRegelVerzendweek } from '@/lib/supabase/queries/orders'
import { isAdminPseudo } from '@/lib/orders/admin-pseudo'
import { bepaalMaatwerkFase, MAATWERK_FASE_PRESENTATIE } from '@/lib/orders/maatwerk-productie'
import { LevertijdBadge, UitwisselbaarToepassenRij, OntgrendelAllocatieKeuzeRij, type OrderRegelLevertijd, type OrderClaim } from '@/modules/reserveringen'
import { OmzettenNaarMaatwerkDialog } from '@/components/orders/omzetten-naar-maatwerk-dialog'
import { RegelVerzendBadge } from '@/components/orders/regel-verzendstatus'
import type { HaalbaarheidsRij } from '@/modules/snijplanning'
import { HAALBAARHEID_STATUS_STYLE } from '@/lib/orders/haalbaarheid-status-badge'
import { usePlanningConfig } from '@/hooks/use-planning-config'
import { useAuth } from '@/hooks/use-auth'

/**
 * Toont in de "Te leveren"-kolom de samenvattende productie-fase van een
 * maatwerk-regel (traagste stuk telt) i.p.v. het misleidende orderaantal.
 * De fijnmazige status per stuk staat als badge onder de regel.
 */
function MaatwerkFaseBadge({ snijplannen }: { snijplannen?: { status: string }[] }) {
  const presentatie = MAATWERK_FASE_PRESENTATIE[bepaalMaatwerkFase(snijplannen)]
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${presentatie.bg} ${presentatie.text}`}
    >
      {presentatie.label}
    </span>
  )
}

function formatVerzendweek(w: string): string {
  const m = w.match(/^(\d{4})-W(\d{2})$/)
  if (!m) return w
  return `Wk ${parseInt(m[2])} · ${m[1]}`
}

/** Toont "Kan al Wk N" als deze regel eerder kan dan de order-verzendweek. */
function VroegstLeverbaerHint({ vroegst, orderVerzendweek }: {
  vroegst: string | null | undefined
  orderVerzendweek: string | null | undefined
}) {
  if (!vroegst) return null
  const regelWeek = isoWeekStringVanIso(vroegst)
  if (!regelWeek || !orderVerzendweek) return null
  // Alleen tonen als de regel eerder klaar is dan de order als geheel
  if (regelWeek >= orderVerzendweek) return null
  const wkNr = parseInt(regelWeek.split('-W')[1] ?? '0')
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded"
      title={`Kan al verzonden worden per ${vroegst} (${regelWeek})`}
    >
      Kan al Wk {wkNr}
    </span>
  )
}

function volgendeWeekVanDatum(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 7)
  return isoWeekString(d)
}

interface VerzendweekCellProps {
  regel: OrderRegel
  orderId: number
  orderdatum: string
  levertijd?: OrderRegelLevertijd
  bewerkbaar: boolean
}

function VerzendweekCell({ regel, orderId, orderdatum, levertijd, bewerkbaar }: VerzendweekCellProps) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { data: planningConfig } = usePlanningConfig()
  // Externe vertegenwoordiger (mig 489): read-only — toon de verzendweek-waarde
  // maar verberg de edit-/reset-triggers.
  const { isExternRep } = useAuth()
  const kanBewerken = bewerkbaar && !isExternRep

  const autoWeek: string | null = (() => {
    // Maatwerk reserveert niet op inkoop, dus de reguliere levertijd_status
    // ('voorraad'/'op_inkoop') is hier altijd 'maatwerk' (mig 150) — geen
    // signaal. Materiaal-beschikbaarheid lezen we i.p.v. daarvan af uit de
    // snijplan-stukken zelf: pas als ALLE een echte rol hebben (zelfde
    // "volledig gepland"-voorwaarde als de auto-verzendweek-trigger, mig 469)
    // tonen we een live-voorstel — vóórdat dat zo is, is elke datum giswerk.
    if (regel.is_maatwerk) {
      const stukken = regel.snijplannen ?? []
      const volledigOpRol = stukken.length > 0 && stukken.every((sp) => sp.rol_id != null)
      if (!volledigOpRol) return null
      const weken = planningConfig?.maatwerk_voorraad_levertijd_weken ?? 7
      const d = new Date()
      d.setUTCDate(d.getUTCDate() + weken * 7)
      return isoWeekString(d)
    }
    if (levertijd?.levertijd_status === 'voorraad') return volgendeWeekVanDatum(orderdatum)
    if (levertijd?.verwachte_leverweek) return levertijd.verwachte_leverweek
    return null
  })()

  const displayed = regel.verzendweek ?? autoWeek
  const isOverride = !!regel.verzendweek
  const bronLabel = regel.verzendweek_bron === 'handmatig'
    ? 'Handmatig ingesteld'
    : regel.verzendweek_bron === 'automatisch_voorraad'
      ? 'Automatisch — materiaal op voorraad'
      : 'Automatisch berekend'

  const mutation = useMutation({
    mutationFn: (w: string | null) => setRegelVerzendweek(regel.id, w),
    onSuccess: () => {
      // Query-key MOET matchen met useOrderRegels (['orders', id, 'regels']),
      // anders ververst de tabel niet en lijkt de opslag mislukt (bug 2026-06-15).
      queryClient.invalidateQueries({ queryKey: ['orders', orderId, 'regels'] })
      setEditing(false)
      setErrorMsg(null)
    },
    onError: (err) => {
      setEditing(false)
      setErrorMsg(err instanceof Error ? err.message : 'Opslaan mislukt — probeer opnieuw')
    },
  })

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const editView = editing ? (() => {
    const initValue = regel.verzendweek ?? autoWeek ?? ''
    return (
      <span className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          type="week"
          defaultValue={initValue}
          disabled={mutation.isPending}
          className="border border-slate-300 rounded px-1 py-0.5 text-xs w-36 focus:outline-none focus:ring-1 focus:ring-terracotta-400 disabled:opacity-50"
          onKeyDown={(e) => {
            if (e.key === 'Enter') mutation.mutate((e.target as HTMLInputElement).value || null)
            if (e.key === 'Escape') setEditing(false)
          }}
        />
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => {
            const inp = inputRef.current
            mutation.mutate(inp?.value || null)
          }}
          className="text-green-600 hover:text-green-700 disabled:opacity-40"
          title="Opslaan"
        >
          <Check size={13} />
        </button>
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => setEditing(false)}
          className="text-slate-400 hover:text-slate-600 disabled:opacity-40"
          title="Annuleren"
        >
          <X size={13} />
        </button>
      </span>
    )
  })() : (
    <span className="inline-flex items-center gap-1 group">
      {displayed ? (
        <span
          className={`text-xs ${isOverride ? 'font-medium text-slate-700' : 'text-slate-400 italic'}`}
          title={bronLabel}
        >
          {formatVerzendweek(displayed)}
        </span>
      ) : (
        <span className="text-xs text-slate-300">—</span>
      )}
      {kanBewerken && (
        <button
          type="button"
          onClick={() => { setEditing(true); setErrorMsg(null) }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-terracotta-500"
          title="Verzendweek aanpassen"
        >
          <Pencil size={11} />
        </button>
      )}
      {isOverride && kanBewerken && (
        <button
          type="button"
          onClick={() => mutation.mutate(null)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-rose-400"
          title="Reset naar auto"
        >
          <X size={11} />
        </button>
      )}
    </span>
  )

  return (
    <span className="inline-flex flex-col gap-0.5">
      {editView}
      {errorMsg && (
        <span className="text-[11px] text-rose-600 inline-flex items-center gap-1">
          {errorMsg}
          <button type="button" onClick={() => setErrorMsg(null)} className="ml-1 hover:text-rose-800 font-bold" title="Sluiten">×</button>
        </span>
      )}
    </span>
  )
}

function formatMaat(regel: OrderRegel): string {
  const l = regel.maatwerk_lengte_cm
  const b = regel.maatwerk_breedte_cm
  if (!l || !b) return ''
  return `${l}×${b} cm`
}

/** Statussen die nog in de snijplanning-pool zitten (TE_SNIJDEN ∪ wacht-varianten) —
 *  alleen hiervoor heeft een link naar /snijplanning zin (zie snijplan-status.ts). */
const SNIJPLANNING_POOL_STATUSSEN = new Set(['Wacht', 'Wacht op inkoop', 'Gepland', 'Snijden'])

/** Welke status-tab op /snijplanning toont dit snijplan? Spiegelt de
 *  client-side classificatie in snijplanning-overview.tsx (rol_id aanwezig =
 *  Te snijden-tab, anders Tekort, behalve de eigen Wacht op inkoop-tab). */
function snijplanningTabVoor(status: string, rolId: number | null): string {
  if (status === 'Wacht op inkoop') return 'Wacht op inkoop'
  return rolId != null ? 'Te snijden' : 'Tekort'
}

function SnijplanStatusBadge({ status, rolId, rolnummer, orderNr, suffix }: {
  status: string
  rolId: number | null
  rolnummer: string | null
  orderNr: string
  suffix?: string | null
}) {
  // status='Gepland' betekent zowel "in de wachtrij zonder rol" als "echt op
  // een rol geplaatst" (zie CLAUDE.md) — alleen rol_id onderscheidt die twee.
  const isGeplandZonderRol = status === 'Gepland' && rolId == null
  const label = isGeplandZonderRol
    ? 'Wacht op planning'
    : status === 'Gepland' && rolnummer
      ? `Gepland · Rol ${rolnummer}`
      : status
  const className = isGeplandZonderRol
    ? 'bg-slate-100 text-slate-600'
    : status === 'Gepland' && rolnummer
      ? 'bg-cyan-100 text-cyan-700'
      : snijplanBadgeClass(status)

  const inhoud = (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {label}
      {suffix && <span className="font-mono opacity-80">· {suffix}</span>}
    </span>
  )

  if (!SNIJPLANNING_POOL_STATUSSEN.has(status)) return inhoud

  const tabParam = snijplanningTabVoor(status, rolId)
  return (
    <Link
      to={`/snijplanning?status=${encodeURIComponent(tabParam)}&zoek=${encodeURIComponent(orderNr)}`}
      title="Bekijk op de snijplanning"
      className="hover:opacity-80"
    >
      {inhoud}
    </Link>
  )
}

/** Afgeleide "wanneer wordt dit nou echt gesneden" naast de status-badge —
 *  dezelfde queue-simulatie (`useSnijHaalbaarheid`) als de Haalbaarheid-pagina,
 *  zodat je dat niet apart hoeft op te zoeken. Geen `stuk` (nog niet bekend,
 *  of dit snijplan valt buiten de haalbaarheid-scope) → niets extra tonen. */
function SnijDatumIndicator({ stuk }: { stuk?: HaalbaarheidsRij }) {
  if (!stuk) return null
  if (stuk.geplandeSnijDatum) {
    const style = HAALBAARHEID_STATUS_STYLE[stuk.haalbaarheidStatus]
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}
        title={`Afgeleid uit de snijwachtrij — ${style.label.toLowerCase()}`}
      >
        → {formatDate(stuk.geplandeSnijDatum)}
      </span>
    )
  }
  if (stuk.inkoopInfo?.verwacht_datum) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
        verwacht {formatDate(stuk.inkoopInfo.verwacht_datum)}
      </span>
    )
  }
  return null
}

// Admin-pseudo-detectie via isAdminPseudo(regel) — ADR-0018 / mig 272-273.
// OrderRegel.is_pseudo wordt uit producten.is_pseudo gemapt door fetchOrderRegels.

// Eindstatussen (mig 270): claims zijn al gereleased door mig 259-trigger, dus
// `te_leveren − Σ actieve claims` levert ten onrechte tekort op. Render geen
// claim-uitsplitsing / wacht-rij. Symmetrisch met view `order_regel_levertijd`.
const EINDSTATUS_ORDERS = new Set(['Verzonden', 'Geannuleerd'])

interface SubRow {
  key: string
  label: React.ReactNode
  aantal: number
  tone: 'neutraal' | 'omsticker' | 'wacht'
}

/** Bouwt sub-rijen voor een orderregel: eigen voorraad → omsticker → IO → wacht. */
function buildSubRows(regel: OrderRegel, claims: OrderClaim[]): SubRow[] {
  const eigen: SubRow[] = []
  const omsticker: SubRow[] = []
  const io: SubRow[] = []

  for (const c of claims) {
    if (c.bron === 'voorraad') {
      const isOmsticker = !!c.fysiek_artikelnr && c.fysiek_artikelnr !== regel.artikelnr
      if (isOmsticker) {
        omsticker.push({
          key: `c${c.id}`,
          tone: 'omsticker',
          aantal: c.aantal,
          label: (
            <span className="inline-flex items-center gap-2 flex-wrap">
              <span className="text-amber-700 font-medium">Omstickeren uit</span>
              <Link
                to={`/producten/${c.fysiek_artikelnr}`}
                className="font-mono text-xs text-terracotta-500 hover:underline"
              >
                {c.fysiek_artikelnr}
              </Link>
              <span className="text-slate-600">{c.fysiek_omschrijving ?? ''}</span>
              {c.fysiek_locatie && (
                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[11px]">
                  Locatie {c.fysiek_locatie}
                </span>
              )}
              <ArrowRight size={11} className="text-slate-400" />
              <span className="text-slate-500">stickeren naar {regel.artikelnr}</span>
            </span>
          ),
        })
      } else {
        eigen.push({
          key: `c${c.id}`,
          tone: 'neutraal',
          aantal: c.aantal,
          label: <span className="text-slate-600">Uit eigen voorraad</span>,
        })
      }
    } else if (c.bron === 'inkooporder_regel') {
      io.push({
        key: `c${c.id}`,
        tone: 'neutraal',
        aantal: c.aantal,
        label: (
          <span className="inline-flex items-center gap-2 flex-wrap text-slate-600">
            <span>Op inkooporder</span>
            {c.inkooporder_id ? (
              <Link
                to={`/inkoop/${c.inkooporder_id}`}
                className="font-mono text-xs text-terracotta-500 hover:underline"
              >
                {c.inkooporder_nr ?? `IO #${c.inkooporder_regel_id}`}
              </Link>
            ) : (
              <span className="font-mono text-xs">
                {c.inkooporder_nr ?? `IO #${c.inkooporder_regel_id}`}
              </span>
            )}
            {c.verwacht_datum && (
              <span className="text-slate-500">wk {isoWeekFromString(c.verwacht_datum)}</span>
            )}
          </span>
        ),
      })
    }
  }

  // Synthetische "wacht"-rij voor het ondekte deel
  const totaalGeclaimd = claims.reduce((s, c) => s + c.aantal, 0)
  const tekort = regel.te_leveren - totaalGeclaimd
  const wacht: SubRow[] = []
  if (tekort > 0) {
    wacht.push({
      key: 'wacht',
      tone: 'wacht',
      aantal: tekort,
      label: <span className="text-rose-700 font-medium">Wacht op nieuwe inkoop</span>,
    })
  }

  return [...eigen, ...omsticker, ...io, ...wacht]
}

const TONE_BG: Record<SubRow['tone'], string> = {
  neutraal: 'bg-slate-50/60',
  omsticker: 'bg-amber-50/40',
  wacht: 'bg-rose-50/40',
}

function SubRowTr({ sub }: { sub: SubRow }) {
  return (
    <tr className={`border-b border-slate-50 ${TONE_BG[sub.tone]}`}>
      <td className="px-4 py-1.5"></td>
      <td colSpan={3} className="px-4 py-1.5 text-xs">
        <span className="inline-flex items-center gap-2 pl-3 border-l-2 border-slate-200">
          {sub.label}
        </span>
      </td>
      <td className="px-4 py-1.5"></td>
      <td className="px-4 py-1.5 text-right text-xs font-medium text-slate-700">{sub.aantal}</td>
      <td colSpan={5} className="px-4 py-1.5"></td>
    </tr>
  )
}

interface RegelRowProps {
  regel: OrderRegel
  orderId: number
  orderNr: string
  orderdatum: string
  /** Order-niveau verzendweek (YYYY-Www). Geeft context voor vroegst_leverbaar-hint. */
  orderVerzendweek?: string | null
  levertijd?: OrderRegelLevertijd
  claims: OrderClaim[]
  isEindstatus: boolean
  /** Aantal van deze regel dat al in een eindstatus-zending zit (mig 518/deelzending). */
  verzonden: number
  /** Toon de "Nog te verzenden"-badge (alleen zodra de order al deels de deur uit is). */
  toonNogTeVerzenden: boolean
  /** Afgeleide snijdatum/haalbaarheid per snijplan-id (zelfde id als `regel.snijplannen[].id`). */
  snijHaalbaarheidPerStuk?: Map<number, HaalbaarheidsRij>
}

function RegelRow({ regel, orderId, orderNr, orderdatum, orderVerzendweek, levertijd, claims, isEindstatus, verzonden, toonNogTeVerzenden, snijHaalbaarheidPerStuk }: RegelRowProps) {
  const [omzetOpen, setOmzetOpen] = useState(false)
  // Externe vertegenwoordiger (mig 489): read-only — verberg muteer-triggers
  // (omsticker-rij + omzetten-naar-maatwerk). De UitwisselbaarToepassenRij en
  // OmzettenNaarMaatwerkDialog zijn zelf ook al gegate (defense-in-depth).
  const { isExternRep } = useAuth()
  const afwerkingInfo = regel.maatwerk_afwerking ? AFWERKING_MAP[regel.maatwerk_afwerking] : null
  const maat = formatMaat(regel)
  const toonSubRows = !regel.is_maatwerk
    && regel.te_leveren > 0
    && !isAdminPseudo(regel)
    && !isEindstatus
  const subRows = toonSubRows ? buildSubRows(regel, claims) : []
  // Ongedekt deel (te_leveren − Σ actieve claims) — wat nu op nieuwe inkoop wacht.
  const totaalGeclaimd = claims.reduce((s, c) => s + c.aantal, 0)
  const tekort = regel.te_leveren - totaalGeclaimd

  return (
    <>
      <tr className={`${regel.is_maatwerk || subRows.length > 0 ? 'border-b-0' : 'border-b border-slate-50'} hover:bg-slate-50`}>
        <td className="px-4 py-2 text-slate-400">{regel.regelnummer}</td>
        <td className="px-4 py-2">
          {regel.artikelnr ? (
            <Link
              to={`/producten/${regel.artikelnr}`}
              className="text-terracotta-500 hover:underline font-mono text-xs"
            >
              {regel.artikelnr}
            </Link>
          ) : (
            '—'
          )}
          {regel.klant_artikelnr && (
            <span className="block text-xs text-blue-500" title="Klant artikelnr">
              {regel.klant_artikelnr}
            </span>
          )}
        </td>
        <td className="px-4 py-2 font-mono text-xs text-slate-500">
          {regel.karpi_code ?? '—'}
        </td>
        <td className="px-4 py-2">
          {regel.omschrijving}
          {regel.omschrijving_2 && !regel.is_maatwerk && (
            <span className="block text-xs text-slate-400">{regel.omschrijving_2}</span>
          )}
          {regel.klant_eigen_naam && (
            <span className="block text-xs text-blue-500" title="Klanteigen naam">
              {regel.klant_eigen_naam}
            </span>
          )}
          <div>
            <RegelVerzendBadge regel={regel} verzonden={verzonden} toonNogTeVerzenden={toonNogTeVerzenden} />
          </div>
        </td>
        <td className="px-4 py-2 text-right">{regel.orderaantal}</td>
        <td className="px-4 py-2 text-right">
          {regel.is_maatwerk ? (
            <MaatwerkFaseBadge snijplannen={regel.snijplannen} />
          ) : (
            regel.te_leveren
          )}
        </td>
        <td className="px-4 py-2 text-right">
          {regel.backorder > 0 ? (
            <span className="text-amber-600">{regel.backorder}</span>
          ) : (
            '0'
          )}
        </td>
        <td className="px-4 py-2">
          {levertijd ? (
            <LevertijdBadge levertijd={levertijd} />
          ) : (
            <span className="text-xs text-slate-300">—</span>
          )}
          {!isAdminPseudo(regel) && (
            <div className="mt-1 flex flex-col gap-1">
              <VerzendweekCell
                regel={regel}
                orderId={orderId}
                orderdatum={orderdatum}
                levertijd={levertijd}
                bewerkbaar={!isEindstatus}
              />
              {!regel.is_maatwerk && !isEindstatus && (
                <VroegstLeverbaerHint
                  vroegst={regel.vroegst_leverbaar}
                  orderVerzendweek={orderVerzendweek}
                />
              )}
            </div>
          )}
        </td>
        <td className="px-4 py-2 text-right">{formatCurrency(regel.prijs)}</td>
        <td className="px-4 py-2 text-right">
          {regel.korting_pct > 0 ? `${regel.korting_pct}%` : '—'}
        </td>
        <td className="px-4 py-2 text-right font-medium">
          {formatCurrency(regel.bedrag)}
        </td>
      </tr>
      {regel.is_maatwerk && (
        <tr className="border-b border-slate-50 bg-purple-50/30">
          <td colSpan={11} className="px-4 py-2">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1 text-purple-600 font-medium">
                <Scissors size={12} />
                Maatwerk
              </span>
              {maat ? (
                <span className="text-slate-600 font-medium">{maat}</span>
              ) : regel.omschrijving_2 ? (
                <span className="text-slate-600">{regel.omschrijving_2}</span>
              ) : null}
              {regel.maatwerk_vorm && (
                <span className="text-xs text-purple-600">{getVormDisplay(regel.maatwerk_vorm).label}</span>
              )}
              {afwerkingInfo && (
                <span className={`px-1.5 py-0.5 rounded text-xs ${afwerkingInfo.bg} ${afwerkingInfo.text}`}>
                  {afwerkingInfo.code} — {afwerkingInfo.label}
                </span>
              )}
              {regel.maatwerk_band_kleur && (
                <span className="text-slate-500">Band: {regel.maatwerk_band_kleur}</span>
              )}
              {regel.maatwerk_instructies && (
                <span className="text-slate-500 italic">{regel.maatwerk_instructies}</span>
              )}

              {/* Productie status — klikbaar voor statussen die nog in de
                  snijplanning-pool zitten (linkt naar /snijplanning, gefilterd
                  op deze order). Ingepakt-badge bevat de magazijn-locatie in
                  dezelfde pill ("Ingepakt · A-13"). */}
              {regel.snijplannen && regel.snijplannen.length > 0 && (
                <span className="ml-auto flex items-center gap-2 flex-wrap">
                  {regel.snijplannen.map((sp) => (
                    <span key={sp.id} className="inline-flex items-center gap-1.5">
                      <SnijplanStatusBadge
                        status={sp.status}
                        rolId={sp.rol_id}
                        rolnummer={sp.rolnummer}
                        orderNr={orderNr}
                        suffix={sp.status === 'Ingepakt' ? sp.locatie : null}
                      />
                      <SnijDatumIndicator stuk={snijHaalbaarheidPerStuk?.get(sp.id)} />
                    </span>
                  ))}
                </span>
              )}
              {regel.is_maatwerk && (!regel.snijplannen || regel.snijplannen.length === 0) && (
                <span className="ml-auto text-slate-400 text-xs">Geen snijplan</span>
              )}
            </div>
          </td>
        </tr>
      )}
      {subRows.map((s) => (
        <SubRowTr key={s.key} sub={s} />
      ))}
      {!isExternRep && toonSubRows && tekort > 0 && regel.artikelnr && (
        <UitwisselbaarToepassenRij regel={regel} tekort={tekort} claims={claims} />
      )}
      {!isExternRep && toonSubRows && claims.some((c) => c.is_handmatig) && (
        <OntgrendelAllocatieKeuzeRij orderRegelId={regel.id} />
      )}
      {!isExternRep && toonSubRows && tekort > 0 && regel.artikelnr && (
        <tr className="border-b border-slate-50">
          <td className="px-4 py-1.5"></td>
          <td colSpan={10} className="px-4 py-1.5">
            <button
              type="button"
              onClick={() => setOmzetOpen(true)}
              className="inline-flex items-center gap-1.5 pl-3 border-l-2 border-slate-200 text-xs text-terracotta-600 hover:underline"
            >
              <Scissors size={12} />
              Zet om naar maatwerk
            </button>
          </td>
        </tr>
      )}
      {!isExternRep && omzetOpen && (
        <OmzettenNaarMaatwerkDialog
          regel={regel}
          orderId={orderId}
          onClose={() => setOmzetOpen(false)}
        />
      )}
    </>
  )
}

interface OrderRegelsTableProps {
  regels: OrderRegel[]
  isLoading: boolean
  levertijden?: OrderRegelLevertijd[]
  claims?: OrderClaim[]
  orderStatus?: string
  orderId: number
  orderNr: string
  orderdatum: string
  /** ISO-datum van de order-afleverdatum; wordt omgezet naar verzendweek voor de vroegst_leverbaar-hint. */
  orderAfleverdatum?: string | null
  /** Verzonden aantal per order_regel_id (mig 518/deelzending) — voedt de regel-badge. */
  verzondenPerRegel?: Map<number, number>
  /** Afgeleide snijdatum/haalbaarheid per snijplan-id (zie `useSnijHaalbaarheid`). */
  snijHaalbaarheidPerStuk?: Map<number, HaalbaarheidsRij>
}

export function OrderRegelsTable({ regels, isLoading, levertijden, claims, orderStatus, orderId, orderNr, orderdatum, orderAfleverdatum, verzondenPerRegel, snijHaalbaarheidPerStuk }: OrderRegelsTableProps) {
  const [deelzendingOpen, setDeelzendingOpen] = useState(false)
  const isEindstatus = EINDSTATUS_ORDERS.has(orderStatus ?? '')
  // "Nog te verzenden"-badges alleen tonen zodra de order al deels de deur uit is
  // (anders ruis op elke gewone open order). Een afgeronde order is per definitie
  // klaar, dus daar ook niet.
  const heeftVerzonden = Array.from(verzondenPerRegel?.values() ?? []).some((v) => v > 0)
  const toonNogTeVerzenden = heeftVerzonden && !isEindstatus
  const orderVerzendweek = isoWeekStringVanIso(orderAfleverdatum)
  // Externe vertegenwoordiger (mig 489): read-only — geen deelzending starten.
  const { isExternRep } = useAuth()

  // Toon de deelzending-knop alleen als er ≥2 niet-pseudo-regels zijn waarvan
  // minstens 1 eerder klaar is dan de order-verzendweek.
  const heeftDeelzendingKandidaat = !isEindstatus && orderVerzendweek != null && regels.some(
    (r) => !r.is_maatwerk && r.te_leveren > 0 && r.vroegst_leverbaar != null
      && isoWeekStringVanIso(r.vroegst_leverbaar) != null
      && isoWeekStringVanIso(r.vroegst_leverbaar)! < orderVerzendweek,
  )
  const levertijdMap = new Map<number, OrderRegelLevertijd>(
    (levertijden ?? []).map(l => [l.order_regel_id, l]),
  )
  const claimsMap = new Map<number, OrderClaim[]>()
  for (const c of claims ?? []) {
    const arr = claimsMap.get(c.order_regel_id) ?? []
    arr.push(c)
    claimsMap.set(c.order_regel_id, arr)
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-8 text-center text-slate-400">
        Orderregels laden...
      </div>
    )
  }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
        <h3 className="font-medium text-slate-900">
          Orderregels ({regels.length})
        </h3>
        {!isExternRep && heeftDeelzendingKandidaat && (
          <button
            type="button"
            onClick={() => setDeelzendingOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-[var(--radius-sm)] border border-slate-200 text-slate-600 hover:bg-slate-50"
            title="Stuur een deel van de regels alvast — de rest volgt later"
          >
            <PackageCheck size={13} />
            Deelzending starten
          </button>
        )}
      </div>
      {!isExternRep && deelzendingOpen && (
        <DeelzendingDialog
          orderId={orderId}
          orderStatus={orderStatus ?? ''}
          regels={regels}
          orderVerzendweek={orderVerzendweek}
          onClose={() => setDeelzendingOpen(false)}
        />
      )}

      {regels.length === 0 ? (
        <div className="p-8 text-center text-slate-400">Geen orderregels</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="text-left px-4 py-2 font-medium text-slate-600">#</th>
              <th className="text-left px-4 py-2 font-medium text-slate-600">Artikel</th>
              <th className="text-left px-4 py-2 font-medium text-slate-600">Karpi code</th>
              <th className="text-left px-4 py-2 font-medium text-slate-600">Omschrijving</th>
              <th className="text-right px-4 py-2 font-medium text-slate-600">Aantal</th>
              <th className="text-right px-4 py-2 font-medium text-slate-600">Te leveren</th>
              <th className="text-right px-4 py-2 font-medium text-slate-600">Backorder</th>
              <th className="text-left px-4 py-2 font-medium text-slate-600">Levertijd</th>
              <th className="text-right px-4 py-2 font-medium text-slate-600">Prijs</th>
              <th className="text-right px-4 py-2 font-medium text-slate-600">Korting</th>
              <th className="text-right px-4 py-2 font-medium text-slate-600">Bedrag</th>
            </tr>
          </thead>
          <tbody>
            {regels.map((regel) => (
              <RegelRow
                key={regel.id}
                regel={regel}
                orderId={orderId}
                orderNr={orderNr}
                orderdatum={orderdatum}
                orderVerzendweek={orderVerzendweek}
                levertijd={levertijdMap.get(regel.id)}
                claims={claimsMap.get(regel.id) ?? []}
                isEindstatus={isEindstatus}
                verzonden={verzondenPerRegel?.get(regel.id) ?? 0}
                toonNogTeVerzenden={toonNogTeVerzenden}
                snijHaalbaarheidPerStuk={snijHaalbaarheidPerStuk}
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-medium">
              <td colSpan={10} className="px-4 py-2 text-right text-slate-600">
                Totaal
              </td>
              <td className="px-4 py-2 text-right">
                {formatCurrency(regels.reduce((sum, r) => sum + (r.bedrag ?? 0), 0))}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  )
}
