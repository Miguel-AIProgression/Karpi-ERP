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
} from '@/lib/utils/compute-reststukken'
import { cn } from '@/lib/utils/cn'
import { AFWERKING_MAP } from '@/lib/utils/constants'
import type { SnijplanRow, SnijStuk, ReststukRect } from '@/lib/types/productie'

interface RolUitvoerModalProps {
  rolId: number | null
  open: boolean
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Gebeurtenis-types
// ---------------------------------------------------------------------------

type RolGebeurtenis =
  | {
      kind: 'snij'
      y: number
      x: number
      stuk: SnijplanRow
      snijStuk: SnijStuk
    }
  | {
      kind: 'reststuk'
      y: number
      x: number
      breedteCm: number
      lengteCm: number
      index: number
    }
  | {
      kind: 'aangebroken_end'
      y: number
      x: number
      breedteCm: number
      lengteCm: number
    }
  | {
      kind: 'afval'
      y: number
      x: number
      breedteCm: number
      lengteCm: number
    }

function buildRolGebeurtenissen(
  afgevinkteStukkenRows: SnijplanRow[],
  snijStukken: SnijStuk[],
  reststukRects: ReststukRect[],
  aangebrokenEnd: { y_cm: number; breedte_cm: number; lengte_cm: number } | null,
  afvalRects: ReststukRect[],
): RolGebeurtenis[] {
  const events: RolGebeurtenis[] = []

  const snijStukById = new Map<number, SnijStuk>()
  for (const s of snijStukken) {
    if (s.snijplan_id != null) snijStukById.set(s.snijplan_id, s)
  }

  for (const row of afgevinkteStukkenRows) {
    const snijStuk = snijStukById.get(row.id)
    if (!snijStuk) continue
    events.push({
      kind: 'snij',
      y: snijStuk.y_cm,
      x: snijStuk.x_cm,
      stuk: row,
      snijStuk,
    })
  }

  const sortedReststukken = [...reststukRects].sort(
    (a, b) => a.y_cm - b.y_cm || a.x_cm - b.x_cm,
  )
  sortedReststukken.forEach((r, i) => {
    events.push({
      kind: 'reststuk',
      y: r.y_cm,
      x: r.x_cm,
      breedteCm: r.breedte_cm,
      lengteCm: r.lengte_cm,
      index: i + 1,
    })
  })

  if (aangebrokenEnd) {
    events.push({
      kind: 'aangebroken_end',
      y: aangebrokenEnd.y_cm,
      x: 0,
      breedteCm: aangebrokenEnd.breedte_cm,
      lengteCm: aangebrokenEnd.lengte_cm,
    })
  }

  for (const r of afvalRects) {
    events.push({
      kind: 'afval',
      y: r.y_cm,
      x: r.x_cm,
      breedteCm: r.breedte_cm,
      lengteCm: r.lengte_cm,
    })
  }

  events.sort((a, b) => a.y - b.y || a.x - b.x)
  return events
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

  const { reststukken: reststukRects, aangebrokenEnd, afval: afvalRects } = useMemo(
    () =>
      computeReststukkenAngebrokenAfval(
        rolLengte,
        rolBreedte,
        afgevinkteSnijStukken,
        rolDetail?.rol_type ?? null,
      ),
    [rolLengte, rolBreedte, afgevinkteSnijStukken, rolDetail?.rol_type],
  )

  // Afgevinkte SnijplanRow's in dezelfde volgorde als teSnijden, voor gebeurtenis-lijst
  const afgevinkteRows = useMemo(
    () => teSnijden.filter((r) => checkedIds.has(r.id)),
    [teSnijden, checkedIds],
  )

  const gebeurtenissen = useMemo(
    () =>
      buildRolGebeurtenissen(
        afgevinkteRows,
        snijStukken,
        reststukRects,
        aangebrokenEnd,
        afvalRects,
      ),
    [afgevinkteRows, snijStukken, reststukRects, aangebrokenEnd, afvalRects],
  )

  // Ook niet-afgevinkte stukken moeten in de tabel staan (als grijze rij, checkbox uit).
  // Daarvoor maken we een 'display'-lijst: alle teSnijden-rijen (checked of niet) als snij-gebeurtenissen,
  // gecombineerd met reststukken/afval (die alleen van de afgevinkte stukken zijn afgeleid).
  const alleSnijEvents = useMemo(() => {
    const byId = new Map<number, SnijStuk>()
    for (const s of snijStukken) if (s.snijplan_id != null) byId.set(s.snijplan_id, s)
    return teSnijden
      .map((row): RolGebeurtenis | null => {
        const ss = byId.get(row.id)
        if (!ss) return null
        return { kind: 'snij', y: ss.y_cm, x: ss.x_cm, stuk: row, snijStuk: ss }
      })
      .filter((e): e is RolGebeurtenis => e !== null)
  }, [teSnijden, snijStukken])

  const displayGebeurtenissen = useMemo(() => {
    const nonSnij = gebeurtenissen.filter((e) => e.kind !== 'snij')
    return [...alleSnijEvents, ...nonSnij].sort((a, b) => a.y - b.y || a.x - b.x)
  }, [alleSnijEvents, gebeurtenissen])

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
        reststukken: reststukRects,
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
    if (rolId && reststukRects.length > 0) {
      const previews = reststukRects
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
  const aantalReststukken = reststukRects.length
  const aantalAfval = afvalRects.length
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
                {(() => {
                  // Groepeer events in **shelves** (strips langs rol-lengte) zodat de
                  // snij-volgorde de fysieke guillotine-workflow volgt:
                  //   1. Per shelf één breedtesnit over de volle rol-breedte.
                  //   2. Binnen die shelf lengtesnitten tussen stukken (zelfde
                  //      mesinstelling voor alle stukken in dezelfde shelf).
                  // Shelf-grouping op y-band met 5 cm tolerantie (afrondingen).
                  const BAND_STEP = 5
                  const bandKey = (y: number) => Math.round(y / BAND_STEP)
                  const yDimOf = (ev: RolGebeurtenis): number =>
                    ev.kind === 'snij' ? ev.snijStuk.breedte_cm : ev.lengteCm

                  interface ShelfGroep {
                    y: number
                    height: number
                    events: RolGebeurtenis[]
                  }
                  const shelvesMap = new Map<number, ShelfGroep>()
                  for (const ev of displayGebeurtenissen) {
                    const k = bandKey(ev.y)
                    let s = shelvesMap.get(k)
                    if (!s) {
                      s = { y: ev.y, height: 0, events: [] }
                      shelvesMap.set(k, s)
                    }
                    s.events.push(ev)
                    const yEnd = ev.y + yDimOf(ev)
                    if (yEnd - s.y > s.height) s.height = yEnd - s.y
                  }
                  const rawShelves: ShelfGroep[] = Array.from(shelvesMap.values())
                    .sort((a, b) => a.y - b.y)
                  // Merge y-overlappende shelves: als shelf[i].y < shelf[i-1].yEnd,
                  // valt shelf[i] BINNEN de breedtesnit-slice van shelf[i-1] (nested
                  // guillotine: bv. kleiner stuk onder een groter stuk in dezelfde
                  // kolom). Voor de snijder is het dan één fysieke rij met één
                  // breedtesnit — ook al zijn er intern meerdere sub-stukken.
                  const shelves: ShelfGroep[] = []
                  for (const s of rawShelves) {
                    const last = shelves[shelves.length - 1]
                    if (last && s.y < last.y + last.height - 1) {
                      last.events.push(...s.events)
                      const yEnd = Math.max(last.y + last.height, s.y + s.height)
                      last.height = yEnd - last.y
                    } else {
                      shelves.push({ y: s.y, height: s.height, events: [...s.events] })
                    }
                  }
                  // Binnen een shelf sorteren op x (kolom-volgorde), dan op y
                  // (binnen dezelfde kolom bovenste-eerst) — zo staan stukken die
                  // onder elkaar liggen direct na elkaar in de lijst.
                  for (const s of shelves) {
                    s.events.sort((a, b) => {
                      if (a.x !== b.x) return a.x - b.x
                      return a.y - b.y
                    })
                  }

                  return (
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
                        {(() => {
                          // Shelves die alleen uit 'aangebroken_end' bestaan krijgen geen
                          // header — de aangebroken rol is geen snij-operatie, dus een
                          // breedtesnit-instructie slaat nergens op. Daarnaast nummeren we
                          // alleen de shelves die echt gesneden worden, zodat "Rij N" de
                          // werkelijke handeling-volgorde weergeeft.
                          let rijIdx = 0
                          return shelves.map((shelf, shelfIdx) => {
                          const alleenAangebroken = shelf.events.every(
                            (ev) => ev.kind === 'aangebroken_end',
                          )
                          const toonHeader = !alleenAangebroken
                          if (toonHeader) rijIdx += 1
                          // Lengte-mes: snijdt de rol dwars af op de Y-positie
                          // aan het eind van de shelf. Eén waarde per rij.
                          const lengteMesCm = Math.round(shelf.y + shelf.height)
                          const shelfHoogte = Math.round(shelf.height)
                          // Breedte-messen (max 3): interne X-posities waar een
                          // snit langs de rol door de VOLLEDIGE shelf-hoogte kan
                          // lopen zonder een stuk te doorsnijden. Een X waar twee
                          // items elkaar verticaal onderbreken (bv. 265×265 +
                          // 15×265 onder een 280×280) is géén geldige mes-snit —
                          // dat wordt met de hand afgesneden.
                          const xRanges = shelf.events.map((ev) => {
                            const xWidth =
                              ev.kind === 'snij' ? ev.snijStuk.lengte_cm : ev.breedteCm
                            return { start: ev.x, end: ev.x + xWidth }
                          })
                          const kandidaten = Array.from(
                            new Set(
                              shelf.events
                                .filter((ev) => ev.x > 0)
                                .map((ev) => Math.round(ev.x)),
                            ),
                          )
                          // Machine heeft 3 breedte-messen; meer posities betekent
                          // dat de rij niet met één lengte-mes-slag gesneden kan
                          // worden. De edge function (shelf-mes-validator) flagt
                          // dit als waarschuwing, hier tonen we de eerste 3.
                          const MAX_BREEDTE_MESSEN = 3
                          const breedteMesPosities = kandidaten
                            .filter((x) => !xRanges.some((r) => r.start < x && r.end > x))
                            .sort((a, b) => a - b)
                            .slice(0, MAX_BREEDTE_MESSEN)
                          return (
                            <Fragment key={`shelf-${shelfIdx}`}>
                              {toonHeader && (
                                <tr className="bg-amber-50 border-t-2 border-amber-300">
                                  <td colSpan={6} className="py-2 px-3 text-xs text-amber-900">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <Minus size={12} className="text-amber-700" />
                                      <span className="font-semibold">
                                        Rij {rijIdx} · Lengte-mes op {lengteMesCm} cm
                                      </span>
                                      <span className="text-amber-700">
                                        (rij {shelfHoogte} cm hoog)
                                      </span>
                                      {breedteMesPosities.length > 0 && (
                                        <span className="text-amber-800 font-medium">
                                          ·{' '}
                                          {breedteMesPosities
                                            .map((x, i) => `Breedte-mes ${i + 1} op ${x} cm`)
                                            .join(' · ')}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                              {shelf.events.map((e, idx) => {
                          if (e.kind === 'snij') {
                            const stuk = e.stuk
                            const checked = checkedIds.has(stuk.id)
                            // SnijStuk noemt X (over de rolbreedte) "lengte_cm" en Y (langs
                            // de rollengte) "breedte_cm" — vertaal hier naar de UI-conventie
                            // breedte × lengte = over × langs (zelfde als header en reststukken).
                            const placedBreedte = Math.round(e.snijStuk.lengte_cm)
                            const placedLengte = Math.round(e.snijStuk.breedte_cm)
                            const toonBesteld =
                              stuk.snij_breedte_cm !== undefined &&
                              stuk.snij_lengte_cm !== undefined &&
                              (placedBreedte !== stuk.snij_breedte_cm ||
                                placedLengte !== stuk.snij_lengte_cm)
                            return (
                              <tr
                                key={`snij-${stuk.id}`}
                                className={cn('hover:bg-slate-50', !checked && 'opacity-60')}
                              >
                                <td className="py-2 pl-2 pr-2">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggle(stuk.id)}
                                    className="h-4 w-4 accent-terracotta-500 cursor-pointer"
                                  />
                                </td>
                                <td className="py-2 pr-3 font-medium">
                                  {placedBreedte} × {placedLengte} cm
                                  {stuk.maatwerk_vorm && (
                                    <span className="ml-2 text-xs font-normal text-slate-500">
                                      {stuk.maatwerk_vorm}
                                    </span>
                                  )}
                                  {toonBesteld && (
                                    <span className="ml-2 text-xs font-normal text-slate-400">
                                      (besteld {stuk.snij_breedte_cm}×{stuk.snij_lengte_cm})
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 pr-3">{stuk.klant_naam}</td>
                                <td className="py-2 pr-3">
                                  <Link
                                    to={`/orders/${stuk.order_id}`}
                                    className="text-terracotta-600 hover:underline"
                                    onClick={(ev) => ev.stopPropagation()}
                                  >
                                    {stuk.order_nr}
                                  </Link>
                                </td>
                                <td className="py-2 pr-3">
                                  {stuk.maatwerk_afwerking && AFWERKING_MAP[stuk.maatwerk_afwerking] ? (
                                    <span
                                      className={cn(
                                        'text-xs px-1.5 py-0.5 rounded',
                                        AFWERKING_MAP[stuk.maatwerk_afwerking].bg,
                                        AFWERKING_MAP[stuk.maatwerk_afwerking].text,
                                      )}
                                    >
                                      {stuk.maatwerk_afwerking}
                                    </span>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                                <td className="py-2 pr-3">
                                  <Link
                                    to={`/snijplanning/${stuk.id}/stickers`}
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
                          if (e.kind === 'reststuk') {
                            return (
                              <tr key={`rest-${idx}`} className="bg-emerald-50/40">
                                <td className="py-2 pl-2 pr-2 text-center">
                                  <Package size={14} className="text-emerald-600 inline" />
                                </td>
                                <td className="py-2 pr-3 font-medium text-emerald-800">
                                  <span className="text-xs text-emerald-700 font-semibold mr-1">R{e.index}</span>
                                  {Math.round(e.breedteCm)} × {Math.round(e.lengteCm)} cm
                                </td>
                                <td className="py-2 pr-3 text-xs text-emerald-700" colSpan={2}>
                                  → voorraad ({rolnummer}-R{e.index})
                                </td>
                                <td className="py-2 pr-3 text-xs text-slate-400">Reststuk</td>
                                <td className="py-2 pr-3">
                                  <button
                                    onClick={() =>
                                      printReststukSticker({
                                        rolnummer,
                                        index: e.index,
                                        kwaliteit,
                                        kleur,
                                        lengte_cm: e.lengteCm,
                                        breedte_cm: e.breedteCm,
                                      })
                                    }
                                    className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:underline"
                                  >
                                    <Printer size={12} />
                                    Preview sticker
                                  </button>
                                </td>
                              </tr>
                            )
                          }
                          if (e.kind === 'aangebroken_end') {
                            return (
                              <tr key={`aang-${idx}`} className="bg-blue-50/50">
                                <td className="py-2 pl-2 pr-2 text-center">
                                  <Package size={14} className="text-blue-600 inline" />
                                </td>
                                <td className="py-2 pr-3 font-medium text-blue-800">
                                  {Math.round(e.breedteCm)} × {Math.round(e.lengteCm)} cm
                                </td>
                                <td className="py-2 pr-3 text-xs text-blue-700" colSpan={2}>
                                  → behoud rol {rolnummer} (aangebroken, volle breedte)
                                </td>
                                <td className="py-2 pr-3 text-xs text-blue-700">Aangebroken</td>
                                <td className="py-2 pr-3 text-xs text-slate-400">—</td>
                              </tr>
                            )
                          }
                          return (
                            <tr key={`afv-${idx}`} className="bg-slate-50/60 text-slate-400">
                              <td className="py-2 pl-2 pr-2 text-center">
                                <Trash2 size={14} className="inline" />
                              </td>
                              <td className="py-2 pr-3">
                                {Math.round(e.breedteCm)} × {Math.round(e.lengteCm)} cm
                              </td>
                              <td className="py-2 pr-3 text-xs italic" colSpan={2}>
                                → afval (te klein voor reststuk)
                              </td>
                              <td className="py-2 pr-3 text-xs">Afval</td>
                              <td className="py-2 pr-3 text-xs">—</td>
                            </tr>
                          )
                              })}
                            </Fragment>
                          )
                        })
                        })()}
                      </tbody>
                    </table>
                  )
                })()}
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
