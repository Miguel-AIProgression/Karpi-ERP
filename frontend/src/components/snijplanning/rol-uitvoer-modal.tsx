import { Fragment, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Link, useNavigate } from 'react-router-dom'
import {
  X,
  Scissors,
  Printer,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Package,
  Trash2,
  Minus,
} from 'lucide-react'
import {
  useRolSnijstukken,
  useStartSnijdenRol,
  usePauzeerSnijdenRol,
  useVoltooiSnijplanRol,
} from '@/hooks/use-snijplanning'
import { useRolDetail } from '@/hooks/use-rollen'
import { ReststukStickerLayout } from './reststuk-sticker-layout'
import { mapSnijplannenToStukken } from '@/lib/utils/snijplan-mapping'
import {
  computeReststukkenAngebrokenAfval,
  RESTSTUK_MIN_SHORT,
  RESTSTUK_MIN_LONG,
} from '@/lib/utils/compute-reststukken'
import { cn } from '@/lib/utils/cn'
import { AFWERKING_MAP } from '@/lib/utils/constants'
import { buildSnijVolgorde, type PlacementInput } from '@/lib/snij-volgorde/derive'
import type { KnifeOperation, Rij } from '@/lib/snij-volgorde/types'

interface RolUitvoerModalProps {
  rolId: number | null
  open: boolean
  onClose: () => void
}

interface SnijShelf {
  y: number
  height: number
  maxX: number
  events: RolGebeurtenis[]
  breedtePosities: number[]    // gesorteerde breedte-mes posities (één per stuk in de rij)
  breedteMesGewijzigd: boolean // false = mes laten staan t.o.v. vorige rij
}

// ---------------------------------------------------------------------------
// Rij-header en piece-rij (gebruiken SnijVolgorde uit /lib/snij-volgorde/)
// ---------------------------------------------------------------------------

function RijHeaderRow({ rij }: { rij: Rij }) {
  const messen = rij.breedte_messen_cm
  const messenText =
    messen.length === 0
      ? null
      : messen.length === 1
        ? `Mes op ${messen[0]} cm breed`
        : messen.map((m, i) => `Mes ${i + 1} op ${m} cm`).join(' · ')

  return (
    <tr className="bg-amber-50 border-t-2 border-amber-300">
      <td colSpan={6} className="py-2 px-3 text-xs text-amber-900">
        <div className="flex items-center gap-2 flex-wrap">
          <Minus size={12} className="text-amber-700" />
          <span className="font-semibold">Rij {rij.rij_nummer}</span>
          {messenText && <span className="font-medium">· {messenText}</span>}
          {rij.is_breedte_mes_overgenomen && (
            <span className="text-emerald-700 italic">(blijft staan)</span>
          )}
          <span className="text-amber-700">· lengte {rij.lengte_mes_cm} cm</span>
        </div>
      </td>
    </tr>
  )
}

function pieceLabel(piece: KnifeOperation): {
  primary: string
  secondary: string | null
  vorm_badge: string | null
} {
  const sx = piece.snij_maat_x_cm
  const sy = piece.snij_maat_y_cm
  const bx = piece.bestelde_x_cm
  const by = piece.bestelde_y_cm
  switch (piece.handeling.kind) {
    case 'rond_uitsnijden':
      return {
        primary: `${sx} × ${sy} cm`,
        secondary: `→ ${bx} × ${by} rond met de hand uit vierkant`,
        vorm_badge: 'vierkant snijden',
      }
    case 'ovaal_uitsnijden':
      return {
        primary: `${sx} × ${sy} cm`,
        secondary: `→ ${bx} × ${by} ovaal met de hand uit rechthoek`,
        vorm_badge: 'rechthoek snijden',
      }
    case 'orientatie_swap':
      return {
        primary: `${sx} × ${sy} cm`,
        secondary: `→ bijsnijden naar ${bx} × ${by} cm`,
        vorm_badge: null,
      }
    case 'zo_marge_extra':
      return {
        primary: `${sx} × ${sy} cm`,
        secondary: `→ afwerken naar ${bx} × ${by} cm (incl. ZO-marge ${piece.handeling.marge_cm} cm)`,
        vorm_badge: null,
      }
    case 'geen':
    default:
      return {
        primary: `${sx} × ${sy} cm`,
        secondary: null,
        vorm_badge:
          piece.bestelde_vorm && piece.bestelde_vorm !== 'rechthoek'
            ? piece.bestelde_vorm
            : null,
      }
  }
}

function KnifeOperationRow({
  piece,
  checked,
  onToggle,
}: {
  piece: KnifeOperation
  checked: boolean
  onToggle: () => void
}) {
  const label = pieceLabel(piece)
  return (
    <tr className={cn('hover:bg-slate-50', !checked && 'opacity-60')}>
      <td className="py-2 pl-2 pr-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-4 w-4 accent-terracotta-500 cursor-pointer"
        />
      </td>
      <td className="py-2 pr-3 font-medium">
        <div>
          {label.primary}
          {label.vorm_badge && (
            <span className="ml-2 text-xs font-normal text-slate-500">
              {label.vorm_badge}
            </span>
          )}
        </div>
        {label.secondary && (
          <div className="text-xs font-normal text-amber-700 mt-0.5">{label.secondary}</div>
        )}
      </td>
      <td className="py-2 pr-3">{piece.klant_naam}</td>
      <td className="py-2 pr-3">
        <Link
          to={`/orders/${piece.order_id}`}
          className="text-terracotta-600 hover:underline"
          onClick={(ev) => ev.stopPropagation()}
        >
          {piece.order_nr}
        </Link>
      </td>
      <td className="py-2 pr-3">
        {piece.bestelde_afwerking && AFWERKING_MAP[piece.bestelde_afwerking] ? (
          <span
            className={cn(
              'text-xs px-1.5 py-0.5 rounded',
              AFWERKING_MAP[piece.bestelde_afwerking].bg,
              AFWERKING_MAP[piece.bestelde_afwerking].text,
            )}
          >
            {piece.bestelde_afwerking}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className="py-2 pr-3">
        <Link
          to={`/snijplanning/${piece.snijplan_id}/stickers`}
          className="inline-flex items-center gap-1 text-xs text-terracotta-500 hover:underline"
          target="_blank"
        >
          <Printer size={12} />
          Print
        </Link>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Reststuk-sticker preview print (opent nieuw venster)
// ---------------------------------------------------------------------------

function printReststukSticker(props: {
  rolnummer: string
  index: number
  kwaliteit: string
  kleur: string
  lengte_cm: number
  breedte_cm: number
}) {
  const win = window.open('', '_blank', 'width=520,height=360')
  if (!win) return
  const datum = new Date().toLocaleDateString('nl-NL')
  win.document.write(`<!doctype html>
<html lang="nl"><head><meta charset="utf-8"/>
<title>Reststuk sticker preview — ${props.rolnummer}-R${props.index}</title>
<link rel="stylesheet" href="${window.location.origin}/src/index.css" />
<style>
  body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; background: #f8fafc; }
  .hint { font-size: 11px; color: #64748b; margin-bottom: 10px; }
  @media print {
    .hint { display: none; }
    body { padding: 0; background: white; }
  }
</style>
</head><body>
<div class="hint">Preview — gebruik Ctrl/Cmd+P om te printen. Echte sticker met QR-code is pas beschikbaar nadat de rol is afgesloten.</div>
<div id="root"></div>
</body></html>`)
  win.document.close()

  // Render React component into the popup
  const mount = win.document.getElementById('root')
  if (!mount) return
  const root = createRoot(mount)
  root.render(
    <ReststukStickerLayout
      rolnummer={`${props.rolnummer}-R${props.index}`}
      kwaliteit={props.kwaliteit}
      kleur={props.kleur}
      lengte_cm={Math.round(props.lengte_cm)}
      breedte_cm={Math.round(props.breedte_cm)}
      datum={datum}
    />,
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RolUitvoerModal({ rolId, open, onClose: onCloseRaw }: RolUitvoerModalProps) {
  const navigate = useNavigate()
  const { data: stukken, isLoading } = useRolSnijstukken(open ? rolId : null)
  const { data: rolDetail } = useRolDetail(open ? rolId : null)
  const startSnijden = useStartSnijdenRol()
  const pauzeerSnijden = usePauzeerSnijdenRol()
  const voltooiRol = useVoltooiSnijplanRol()

  // DEBUG: log elke call naar onClose met stack trace zodat we zien welke
  // code-path 'm aanroept. Tijdelijk — weg te halen zodra auto-close-bug opgelost.
  const onClose = () => {
    // eslint-disable-next-line no-console
    console.log('[RolUitvoerModal] onClose called', { rolId, open }, new Error('stack').stack)
    onCloseRaw()
  }

  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  const [initialized, setInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [startedRolId, setStartedRolId] = useState<number | null>(null)

  // DEBUG: log open/rolId veranderingen
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[RolUitvoerModal] props changed', { open, rolId })
  }, [open, rolId])

  // DEBUG: log mount/unmount
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[RolUitvoerModal] MOUNT')
    return () => {
      // eslint-disable-next-line no-console
      console.log('[RolUitvoerModal] UNMOUNT')
    }
  }, [])

  useEffect(() => {
    if (!open || !rolId) return
    if (startedRolId === rolId) return
    // eslint-disable-next-line no-console
    console.log('[RolUitvoerModal] start_snijden_rol triggering for rolId', rolId)
    setStartedRolId(rolId)
    startSnijden.mutate(
      { rolId },
      {
        onSuccess: (data) => {
          // eslint-disable-next-line no-console
          console.log('[RolUitvoerModal] start_snijden_rol SUCCESS', data)
        },
        onError: (err) => {
          // eslint-disable-next-line no-console
          console.error('[RolUitvoerModal] start_snijden_rol ERROR', err)
        },
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rolId])

  useEffect(() => {
    if (!open) {
      setCheckedIds(new Set())
      setInitialized(false)
      setError(null)
      setSuccess(null)
      setStartedRolId(null)
    }
  }, [open])

  const teSnijden = useMemo(
    () => (stukken ?? []).filter((s) => s.status === 'Gepland' || s.status === 'Snijden'),
    [stukken],
  )

  useEffect(() => {
    if (!initialized && teSnijden.length > 0) {
      setCheckedIds(new Set(teSnijden.map((s) => s.id)))
      setInitialized(true)
    }
  }, [initialized, teSnijden])

  const eerste = stukken?.[0]
  const rolnummer = eerste?.rolnummer ?? 'Onbekend'
  const rolBreedte = eerste?.rol_breedte_cm ?? 400
  const rolLengte = eerste?.rol_lengte_cm ?? 2000
  const kwaliteit = eerste?.kwaliteit_code ?? ''
  const kleur = eerste?.kleur_code ?? ''

  const { snijStukken } = useMemo(
    () => mapSnijplannenToStukken(stukken ?? [], rolBreedte, rolLengte),
    [stukken, rolBreedte, rolLengte],
  )

  // Afgevinkte snij-stukken (op basis van snijStukken met snijplan_id in checkedIds)
  const afgevinkteSnijStukken = useMemo(
    () =>
      snijStukken.filter((s) => s.snijplan_id != null && checkedIds.has(s.snijplan_id)),
    [snijStukken, checkedIds],
  )

  const { aangebrokenEnd } = useMemo(
    () =>
      computeReststukkenAngebrokenAfval(
        rolLengte,
        rolBreedte,
        afgevinkteSnijStukken,
        rolDetail?.rol_type ?? null,
      ),
    [rolLengte, rolBreedte, afgevinkteSnijStukken, rolDetail?.rol_type],
  )

  // Afgevinkte SnijplanRow's voor de "rol afsluiten"-flow.
  const afgevinkteRows = useMemo(
    () => teSnijden.filter((r) => checkedIds.has(r.id)),
    [teSnijden, checkedIds],
  )

  // SnijVolgorde: pure transformatie van placements + reststuk/afval/aangebroken
  // naar operator-rijen ("Mes op X breed, lengte Y") — zie
  // frontend/src/lib/snij-volgorde/derive.ts. Rijen reflecteren ALLE teSnijden
  // (ook niet-afgevinkte, om de volgorde context te tonen). Reststukken/afval/
  // aangebroken zijn afgeleid van afgevinkte alleen — dat verandert wanneer de
  // operator een stuk uitvinkt.
  const snijVolgorde = useMemo(() => {
    const placements: PlacementInput[] = teSnijden.map((row) => ({
      id: row.id,
      snijplan_nr: row.snijplan_nr,
      positie_x_cm: row.positie_x_cm ?? 0,
      positie_y_cm: row.positie_y_cm ?? 0,
      snij_lengte_cm: row.snij_lengte_cm,
      snij_breedte_cm: row.snij_breedte_cm,
      geroteerd: row.geroteerd,
      // Fallback 0 zolang migratie 143 nog niet is toegepast — UI toont dan
      // bestelde maat zonder marge (cosmetisch issue, geen functionele fout).
      marge_cm: row.marge_cm ?? 0,
      maatwerk_vorm: row.maatwerk_vorm,
      maatwerk_afwerking: row.maatwerk_afwerking,
      order_id: row.order_id,
      order_nr: row.order_nr,
      klant_naam: row.klant_naam,
      artikelnr: row.artikelnr,
      afleverdatum: row.afleverdatum,
    }))
    return buildSnijVolgorde({
      rolnummer,
      rol_breedte_cm: rolBreedte,
      rol_lengte_cm: rolLengte,
      placements,
      reststukken: reststukRects,
      aangebrokenEnd,
      afval: afvalRects,
    })
  }, [teSnijden, rolnummer, rolBreedte, rolLengte, reststukRects, aangebrokenEnd, afvalRects])

  if (!open || !rolId) return null

  const toggle = (id: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (checkedIds.size === teSnijden.length) setCheckedIds(new Set())
    else setCheckedIds(new Set(teSnijden.map((s) => s.id)))
  }

  const handleAfsluiten = () => {
    if (!rolId) return
    const afgevinkt = Array.from(checkedIds)
    const nietAangevinkt = teSnijden.length - afgevinkt.length

    if (nietAangevinkt > 0) {
      const ok = window.confirm(
        `${nietAangevinkt} stuk${nietAangevinkt === 1 ? '' : 'ken'} niet aangevinkt — deze gaan terug naar de wachtlijst voor de volgende optimalisatie-run. Doorgaan?`,
      )
      if (!ok) return
    }

    const aangebrokenLengte =
      aangebrokenEnd && aangebrokenEnd.lengte_cm >= 100 ? aangebrokenEnd.lengte_cm : null

    setError(null)
    voltooiRol.mutate(
      {
        rolId,
        snijplanIds: afgevinkt,
        reststukken: snijVolgorde.reststukken,
        aangebrokenLengte,
      },
      {
        onSuccess: () => {
          const extra = aangebrokenLengte
            ? ` · rol blijft aangebroken (${aangebrokenLengte} cm over)`
            : ''
          setSuccess(
            `Rol afgesloten: ${afgevinkt.length} stuk${afgevinkt.length === 1 ? '' : 'ken'} gesneden${nietAangevinkt > 0 ? `, ${nietAangevinkt} terug naar wachtlijst` : ''}${extra}.`,
          )
          setTimeout(() => onClose(), 1200)
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'Onbekende fout'),
      },
    )
  }

  const printBulk = () => {
    // Geef reststuk-preview data mee via sessionStorage zodat stickers-bulk
    // ook de (nog niet in DB bestaande) reststukken kan renderen.
    if (rolId && snijVolgorde.reststukken.length > 0) {
      const previews = snijVolgorde.reststukken
        .slice()
        .sort((a, b) => a.y_cm - b.y_cm || a.x_cm - b.x_cm)
        .map((r, i) => ({
          rolnummer: `${rolnummer}-R${i + 1}`,
          kwaliteit_code: kwaliteit,
          kleur_code: kleur,
          lengte_cm: r.lengte_cm,
          breedte_cm: r.breedte_cm,
        }))
      sessionStorage.setItem(`reststuk-preview-${rolId}`, JSON.stringify(previews))
    } else if (rolId) {
      sessionStorage.removeItem(`reststuk-preview-${rolId}`)
    }
    navigate(`/snijplanning/stickers?kwaliteit=${kwaliteit}&kleur=${kleur}&rol=${rolId}`)
  }

  const requestClose = () => {
    if (startedRolId !== null) {
      const ok = window.confirm(
        'De rol is gestart en staat nog open. Weet je zeker dat je wilt sluiten zonder af te sluiten? De starttijd blijft bewaard en je kunt later verder.',
      )
      if (!ok) return
    }
    onClose()
  }

  const handlePauzeer = async () => {
    if (!rolId) return
    setError(null)
    try {
      await pauzeerSnijden.mutateAsync({ rolId })
      setStartedRolId(null)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout bij pauzeren')
    }
  }

  const aantalTeSnijdenAfgevinkt = afgevinkteRows.length
  const aantalReststukken = snijVolgorde.reststukken.length
  const aantalAfval = snijVolgorde.aantalAfval
  const aantalAangebroken = aangebrokenEnd ? 1 : 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div
        className="bg-white rounded-lg shadow-2xl w-[880px] max-w-[95vw] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Scissors size={16} className="text-indigo-500" />
            <span className="font-semibold text-sm">Rol snijden — {rolnummer}</span>
            <span className="text-xs text-slate-500">
              {kwaliteit} {kleur} · {rolBreedte} × {rolLengte} cm (breedte × lengte)
            </span>
          </div>
          <button onClick={requestClose} className="text-slate-400 hover:text-slate-600" title="Sluiten">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={14} className="animate-spin" />
              Stukken laden...
            </div>
          ) : !stukken || stukken.length === 0 ? (
            <div className="text-sm text-slate-500">Geen stukken gevonden op deze rol.</div>
          ) : (
            <>
              {/* Gebeurtenissen-lijst bovenaan */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-slate-700">
                    Snij-volgorde ({aantalTeSnijdenAfgevinkt} te snijden · {aantalReststukken}{' '}
                    reststukken{aantalAangebroken > 0 ? ` · 1 aangebroken rol` : ''} · {aantalAfval}{' '}
                    afval)
                  </h3>
                  <button
                    onClick={toggleAll}
                    className="text-xs text-terracotta-600 hover:underline"
                  >
                    {checkedIds.size === teSnijden.length ? 'Alles uitvinken' : 'Alles aanvinken'}
                  </button>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                      <th className="py-2 pr-2 w-8"></th>
                      <th className="py-2 pr-3">Maat</th>
                      <th className="py-2 pr-3">Klant / Bestemming</th>
                      <th className="py-2 pr-3">Order</th>
                      <th className="py-2 pr-3">Afwerking</th>
                      <th className="py-2 pr-3">Actie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snijVolgorde.rijen.map((rij) => (
                      <Fragment key={`rij-${rij.rij_nummer}`}>
                        <RijHeaderRow rij={rij} />
                        {rij.pieces.map((piece) => {
                          const checked = checkedIds.has(piece.snijplan_id)
                          return (
                            <KnifeOperationRow
                              key={`piece-${piece.snijplan_id}`}
                              piece={piece}
                              checked={checked}
                              onToggle={() => toggle(piece.snijplan_id)}
                            />
                          )
                        })}
                      </Fragment>
                    ))}
                    {snijVolgorde.reststukken.map((r) => (
                      <tr key={`rest-${r.letter}`} className="bg-emerald-50/40">
                        <td className="py-2 pl-2 pr-2 text-center">
                          <Package size={14} className="text-emerald-600 inline" />
                        </td>
                        <td className="py-2 pr-3 font-medium text-emerald-800">
                          <span className="text-xs text-emerald-700 font-semibold mr-1">{r.letter}</span>
                          {r.breedte_cm} × {r.lengte_cm} cm
                        </td>
                        <td className="py-2 pr-3 text-xs text-emerald-700" colSpan={2}>
                          → voorraad ({r.rolnummer_volledig})
                        </td>
                        <td className="py-2 pr-3 text-xs text-slate-400">Reststuk</td>
                        <td className="py-2 pr-3">
                          <button
                            onClick={() =>
                              printReststukSticker({
                                rolnummer,
                                index: parseInt(r.letter.slice(1), 10),
                                kwaliteit,
                                kleur,
                                lengte_cm: r.lengte_cm,
                                breedte_cm: r.breedte_cm,
                              })
                            }
                            className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline"
                          >
                            <Printer size={12} />
                            Preview sticker
                          </button>
                        </td>
                      </tr>
                    ))}
                    {snijVolgorde.aangebroken_rest && (
                      <tr className="bg-blue-50/50">
                        <td className="py-2 pl-2 pr-2 text-center">
                          <Package size={14} className="text-blue-600 inline" />
                        </td>
                        <td className="py-2 pr-3 font-medium text-blue-800">
                          {snijVolgorde.aangebroken_rest.breedte_cm} ×{' '}
                          {snijVolgorde.aangebroken_rest.lengte_cm} cm
                        </td>
                        <td className="py-2 pr-3 text-xs text-blue-700" colSpan={2}>
                          → behoud rol {rolnummer} (aangebroken, volle breedte)
                        </td>
                        <td className="py-2 pr-3 text-xs text-blue-700">Aangebroken</td>
                        <td className="py-2 pr-3 text-xs text-slate-400">—</td>
                      </tr>
                    )}
                    {snijVolgorde.afval.map((a, idx) => (
                      <tr key={`afv-${idx}`} className="bg-slate-50/60 text-slate-400">
                        <td className="py-2 pl-2 pr-2 text-center">
                          <Trash2 size={14} className="inline" />
                        </td>
                        <td className="py-2 pr-3">
                          {a.breedte_cm} × {a.lengte_cm} cm
                        </td>
                        <td className="py-2 pr-3 text-xs italic" colSpan={2}>
                          → afval (te klein voor reststuk)
                        </td>
                        <td className="py-2 pr-3 text-xs">Afval</td>
                        <td className="py-2 pr-3 text-xs">—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

            </>
          )}

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-start gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded text-sm text-emerald-700">
              <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" />
              {success}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-200 bg-slate-50 flex-shrink-0">
          <button
            onClick={printBulk}
            disabled={!stukken || stukken.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 bg-white text-sm hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            <Printer size={14} />
            Print alle stickers (bulk)
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              {checkedIds.size}/{teSnijden.length} aangevinkt
            </span>
            <button
              onClick={handlePauzeer}
              disabled={pauzeerSnijden.isPending}
              className="px-3 py-2 rounded-[var(--radius-sm)] text-sm text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
              title="Lock vrijgeven zodat de rol weer herplant kan worden"
            >
              {pauzeerSnijden.isPending ? 'Pauzeren…' : 'Pauzeer'}
            </button>
            <button
              onClick={handleAfsluiten}
              disabled={voltooiRol.isPending || teSnijden.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] bg-emerald-500 text-white font-medium text-sm hover:bg-emerald-600 transition-colors disabled:opacity-50"
            >
              {voltooiRol.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <CheckCircle2 size={14} />
              )}
              Rol afsluiten
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
