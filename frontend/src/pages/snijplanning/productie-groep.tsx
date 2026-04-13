import { useState, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, Scissors, Printer, CheckCircle2, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { SnijVisualisatie } from '@/components/snijplanning/snij-visualisatie'
import { ReststukBevestigingModal } from '@/components/snijplanning/reststuk-bevestiging-modal'
import { ReststukStickerLayout } from '@/components/snijplanning/reststuk-sticker-layout'
import { useSnijplannenVoorGroep, useVoltooiSnijplanRol, useStartProductieRol } from '@/hooks/use-snijplanning'
import type { ReststukResult } from '@/hooks/use-snijplanning'
import { usePlanningConfig } from '@/hooks/use-planning-config'
import { mapSnijplannenToStukken } from '@/lib/utils/snijplan-mapping'
import { cn } from '@/lib/utils/cn'
import { AFWERKING_MAP } from '@/lib/utils/constants'
import type { SnijplanRow } from '@/lib/types/productie'

interface RolGroepData {
  rolId: number
  rolnummer: string
  rolBreedte: number
  rolLengte: number
  stukken: SnijplanRow[]
}

/** Groepeer stukken per rol_id */
function groepeerPerRol(stukken: SnijplanRow[]): RolGroepData[] {
  const map = new Map<number, RolGroepData>()
  for (const s of stukken) {
    if (!s.rol_id) continue
    if (!map.has(s.rol_id)) {
      map.set(s.rol_id, {
        rolId: s.rol_id,
        rolnummer: s.rolnummer ?? 'Onbekend',
        rolBreedte: s.rol_breedte_cm ?? 400,
        rolLengte: s.rol_lengte_cm ?? 2000,
        stukken: [],
      })
    }
    map.get(s.rol_id)!.stukken.push(s)
  }
  return Array.from(map.values())
}

export function ProductieGroepPage() {
  const [params] = useSearchParams()
  const kwaliteit = params.get('kwaliteit') ?? ''
  const kleur = params.get('kleur') ?? ''

  const { data: alleStukken, isLoading } = useSnijplannenVoorGroep(kwaliteit, kleur, !!kwaliteit && !!kleur)

  const rolGroepen = useMemo(() => {
    if (!alleStukken) return []
    return groepeerPerRol(alleStukken)
  }, [alleStukken])

  // Stukken zonder rol (nog niet ingepland)
  const zonderRol = useMemo(() => {
    return (alleStukken ?? []).filter(s => !s.rol_id && s.status === 'Snijden')
  }, [alleStukken])

  const totaalTeSnijden = (alleStukken ?? []).filter(s => s.status === 'Snijden').length
  const totaalGesneden = (alleStukken ?? []).filter(s => s.status === 'Gesneden' || s.status === 'In confectie' || s.status === 'Gereed').length
  const { data: planningConfig } = usePlanningConfig()

  const geschatteTijd = useMemo(() => {
    if (!planningConfig || rolGroepen.length === 0) return null
    const minuten = (rolGroepen.length * planningConfig.wisseltijd_minuten) + (totaalTeSnijden * planningConfig.snijtijd_minuten)
    if (minuten === 0) return null
    const uren = Math.floor(minuten / 60)
    const min = Math.round(minuten % 60)
    if (uren === 0) return `${min} min`
    return min === 0 ? `${uren} uur` : `${uren} uur ${min} min`
  }, [planningConfig, rolGroepen.length, totaalTeSnijden])

  if (isLoading) {
    return <PageHeader title="Laden..." />
  }

  return (
    <>
      <PageHeader
        title={`Productie — ${kwaliteit} ${kleur}`}
        description={`${rolGroepen.length} rollen · ${totaalTeSnijden} te snijden · ${totaalGesneden} gesneden${geschatteTijd ? ` · ~${geschatteTijd}` : ''}`}
        actions={
          <div className="flex items-center gap-3">
            <Link
              to="/snijplanning"
              className="flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-sm)] text-sm text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <ArrowLeft size={16} />
              Terug
            </Link>
            <Link
              to={`/snijplanning/stickers?kwaliteit=${kwaliteit}&kleur=${kleur}&status=Gepland`}
              className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm hover:bg-slate-50 transition-colors"
            >
              <Printer size={16} />
              Alle stickers
            </Link>
          </div>
        }
      />

      {zonderRol.length > 0 && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-[var(--radius)] text-sm text-amber-700">
          {zonderRol.length} stukken zijn nog niet aan een rol toegewezen. Ga terug naar de snijplanning om een snijvoorstel te genereren.
        </div>
      )}

      {rolGroepen.length === 0 ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Geen rollen met geplande stukken gevonden
        </div>
      ) : (
        <div className="space-y-6">
          {rolGroepen.map((rol) => (
            <RolCard key={rol.rolId} rol={rol} kwaliteit={kwaliteit} kleur={kleur} />
          ))}
        </div>
      )}
    </>
  )
}

function RolCard({ rol, kwaliteit, kleur }: { rol: RolGroepData; kwaliteit: string; kleur: string }) {
  const voltooiRol = useVoltooiSnijplanRol()
  const startProductie = useStartProductieRol()
  const [voltooid, setVoltooid] = useState(false)
  const [inProductie, setInProductie] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [showReststukModal, setShowReststukModal] = useState(false)
  const [reststukResult, setReststukResult] = useState<ReststukResult | null>(null)

  const teSnijden = rol.stukken.filter(s => s.status === 'Snijden')
  const alGesneden = rol.stukken.filter(s => s.status === 'Gesneden' || s.status === 'In confectie' || s.status === 'Gereed')
  const heeftGepland = teSnijden.length > 0 && !inProductie

  const { snijStukken, gebruikteLengte, afvalPct, reststukBruikbaar } =
    mapSnijplannenToStukken(rol.stukken, rol.rolBreedte, rol.rolLengte)

  const restLengte = rol.rolLengte - gebruikteLengte

  const handleVoltooiRol = () => {
    setError(null)
    if (restLengte > 50) {
      setShowReststukModal(true)
    } else {
      voltooiRol.mutate(
        { rolId: rol.rolId, overrideRestLengte: 0 },
        {
          onSuccess: () => { setVoltooid(true); setOpen(true) },
          onError: (err) => setError(err instanceof Error ? err.message : 'Onbekende fout'),
        },
      )
    }
  }

  const handleReststukBevestig = (lengte: number) => {
    setShowReststukModal(false)
    voltooiRol.mutate(
      { rolId: rol.rolId, overrideRestLengte: lengte },
      {
        onSuccess: (data) => {
          setVoltooid(true)
          setOpen(true)
          const result = Array.isArray(data) ? data[0] : data
          if (result?.reststuk_id) setReststukResult(result)
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'Onbekende fout'),
      },
    )
  }

  const handleGeenReststuk = () => {
    setShowReststukModal(false)
    voltooiRol.mutate(
      { rolId: rol.rolId, overrideRestLengte: 0 },
      {
        onSuccess: () => { setVoltooid(true); setOpen(true) },
        onError: (err) => setError(err instanceof Error ? err.message : 'Onbekende fout'),
      },
    )
  }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      {/* Rol header — klikbaar om uit te vouwen */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open) } }}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-slate-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          {open ? (
            <ChevronDown size={16} className="text-slate-400 flex-shrink-0" />
          ) : (
            <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />
          )}
          <h2 className="text-base font-semibold text-slate-900">{rol.rolnummer}</h2>
          <span className="text-sm text-slate-500">
            {rol.rolBreedte} × {rol.rolLengte} cm
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            {rol.stukken.length} stuks
          </span>
          {alGesneden.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
              {alGesneden.length} gesneden
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {voltooid ? (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium">
              <CheckCircle2 size={16} />
              Gesneden
            </span>
          ) : heeftGepland ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setError(null)
                startProductie.mutate(rol.rolId, {
                  onSuccess: () => setInProductie(true),
                  onError: (err) => setError(err instanceof Error ? err.message : 'Onbekende fout'),
                })
              }}
              disabled={startProductie.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] bg-indigo-500 text-white font-medium hover:bg-indigo-600 transition-colors disabled:opacity-50"
            >
              {startProductie.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Scissors size={16} />
              )}
              Start productie ({teSnijden.length} stuks)
            </button>
          ) : teSnijden.length > 0 ? (
            <button
              onClick={(e) => { e.stopPropagation(); handleVoltooiRol() }}
              disabled={voltooiRol.isPending}
              className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] bg-emerald-500 text-white font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50"
            >
              {voltooiRol.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Scissors size={16} />
              )}
              Rol gesneden ({teSnijden.length} stuks)
            </button>
          ) : null}
          <Link
            to={`/snijplanning/stickers?kwaliteit=${kwaliteit}&kleur=${kleur}&rol=${rol.rolId}`}
            onClick={(e) => e.stopPropagation()}
            className="text-slate-400 hover:text-slate-600"
            title="Stickers printen"
          >
            <Printer size={16} />
          </Link>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-[var(--radius-sm)] text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Visualisatie + tabel — uitklapbaar */}
      {open && (
        <div className="border-t border-slate-100 p-6">
        <div className="flex justify-center mb-4">
          <SnijVisualisatie
            rolBreedte={rol.rolBreedte}
            rolLengte={rol.rolLengte}
            stukken={snijStukken}
            restLengte={restLengte}
            afvalPct={afvalPct}
            reststukBruikbaar={reststukBruikbaar}
            className="max-w-2xl"
          />
        </div>

        {/* Stukken tabel */}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
              <th className="py-2 pr-3">Nr</th>
              <th className="py-2 pr-3">Maat</th>
              <th className="py-2 pr-3">Klant</th>
              <th className="py-2 pr-3">Order</th>
              <th className="py-2 pr-3">Afwerking</th>
              <th className="py-2 pr-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rol.stukken.map((stuk) => (
              <tr key={stuk.id} className="hover:bg-slate-50">
                <td className="py-2 pr-3 text-xs text-slate-500">{stuk.snijplan_nr}</td>
                <td className="py-2 pr-3 font-medium">
                  {stuk.snij_breedte_cm}×{stuk.snij_lengte_cm} cm
                </td>
                <td className="py-2 pr-3">{stuk.klant_naam}</td>
                <td className="py-2 pr-3">
                  <Link to={`/orders/${stuk.order_id}`} className="text-terracotta-600 hover:underline">
                    {stuk.order_nr}
                  </Link>
                </td>
                <td className="py-2 pr-3">
                  {stuk.maatwerk_afwerking && AFWERKING_MAP[stuk.maatwerk_afwerking] ? (
                    <span className={cn('text-xs px-1.5 py-0.5 rounded', AFWERKING_MAP[stuk.maatwerk_afwerking].bg, AFWERKING_MAP[stuk.maatwerk_afwerking].text)}>
                      {stuk.maatwerk_afwerking}
                    </span>
                  ) : '—'}
                </td>
                <td className="py-2 pr-3">
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded',
                    stuk.status === 'Snijden' ? 'bg-blue-100 text-blue-700'
                      : stuk.status === 'Gesneden' ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-600'
                  )}>
                    {stuk.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Reststuk sticker */}
        {reststukResult?.reststuk_rolnummer && (
          <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-[var(--radius-sm)]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-emerald-700">
                Reststuk {reststukResult.reststuk_rolnummer} ({reststukResult.reststuk_lengte_cm} cm) aangemaakt
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); window.print() }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-sm)] bg-emerald-500 text-white text-sm hover:bg-emerald-600 transition-colors"
              >
                <Printer size={14} />
                Print sticker
              </button>
            </div>
            <ReststukStickerLayout
              rolnummer={reststukResult.reststuk_rolnummer}
              kwaliteit={kwaliteit}
              kleur={kleur}
              lengte_cm={reststukResult.reststuk_lengte_cm ?? 0}
              breedte_cm={rol.rolBreedte}
              datum={new Date().toLocaleDateString('nl-NL')}
            />
          </div>
        )}
        </div>
      )}

      {/* Reststuk bevestigingsmodal */}
      {showReststukModal && (
        <ReststukBevestigingModal
          berekendeLengte={restLengte}
          rolBreedte={rol.rolBreedte}
          kwaliteit={kwaliteit}
          kleur={kleur}
          rolnummer={rol.rolnummer}
          onBevestig={handleReststukBevestig}
          onGeenReststuk={handleGeenReststuk}
          onAnnuleer={() => setShowReststukModal(false)}
        />
      )}
    </div>
  )
}
