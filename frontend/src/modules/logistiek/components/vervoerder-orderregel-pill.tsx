import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Lock, Loader2, Sparkles, Truck, User } from 'lucide-react'
import {
  useEffectieveVervoerderPerOrderregel,
  useUpdateOrderregelVervoerderOverride,
} from '../hooks/use-orderregel-vervoerder'
import { useVervoerders } from '../hooks/use-vervoerder-config'
import { getVervoerderDef, type VervoerderBadgeKleur } from '../registry'

const KLEUR_STYLES: Record<VervoerderBadgeKleur, string> = {
  blauw: 'bg-blue-50 text-blue-700 hover:bg-blue-100 ring-1 ring-blue-200',
  oranje: 'bg-orange-50 text-orange-700 hover:bg-orange-100 ring-1 ring-orange-200',
  paars: 'bg-purple-50 text-purple-700 hover:bg-purple-100 ring-1 ring-purple-200',
  grijs: 'bg-slate-50 text-slate-500 hover:bg-slate-100 ring-1 ring-slate-200',
}

const DOT_STYLES: Record<VervoerderBadgeKleur, string> = {
  blauw: 'bg-blue-500',
  oranje: 'bg-orange-500',
  paars: 'bg-purple-500',
  grijs: 'bg-slate-400',
}

interface Props {
  orderId: number
  orderregelId: number
  /** Komt uit `order.actieve_pickronde != null` — locked = geen wijziging mogelijk. */
  locked: boolean
}

const DROPDOWN_BREEDTE = 240 // px — komt overeen met w-60

/**
 * Compacte pill achter een orderregel die toont welke vervoerder uiteindelijk
 * geldt voor díe regel. Klik = dropdown om een override te zetten of te
 * vervallen op de order-default (klant-fallback / verzendregel-evaluator).
 *
 * De dropdown wordt via een React-portal naar `document.body` gerenderd zodat
 * hij niet wordt geknipt door `overflow-hidden` op de uitklap-tabel-wrapper
 * van de pick-card. Positie wordt fixed berekend uit de button-rect.
 *
 * Bron-iconen:
 *   - Sparkles → regel-evaluator match (automatisch)
 *   - User      → handmatige override op deze regel
 *   - Truck     → klant-fallback (geen regel matcht)
 *   - Lock      → wijziging geblokkeerd (zending bestaat)
 */
export function VervoerderOrderregelPill({ orderId, orderregelId, locked }: Props) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const { data: regels = [] } = useEffectieveVervoerderPerOrderregel(orderId)
  const { data: vervoerders = [] } = useVervoerders()
  const update = useUpdateOrderregelVervoerderOverride()

  const regel = useMemo(
    () => regels.find((r) => r.orderregel_id === orderregelId),
    [regels, orderregelId],
  )

  // Sluit bij click buiten button + popover.
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      const t = e.target as Node
      if (buttonRef.current?.contains(t)) return
      if (popoverRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // Bereken positie zodra dropdown opent + bij scroll/resize. useLayoutEffect
  // zodat de eerste render meteen op de juiste plek staat (geen flicker).
  useLayoutEffect(() => {
    if (!open) return
    function update() {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      // Rechts uitlijnen op de button: left = button.right - dropdown.width.
      const left = Math.max(8, rect.right - DROPDOWN_BREEDTE)
      const top = rect.bottom + 4
      setPos({ top, left })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  // Hooks-rule: alle hooks moeten boven de early-return staan, anders crasht
  // React met "rendered more hooks than during the previous render" zodra
  // `regel` in een volgend render alsnog gevonden wordt.
  const def = regel ? getVervoerderDef(regel.effectief_code) : null
  const labelKleur: VervoerderBadgeKleur = def?.badgeKleur ?? 'grijs'
  const labelText = !regel
    ? '—'
    : regel.bron === 'afhalen'
      ? 'Afhalen'
      : def?.displayNaam ?? (regel.bron === 'geen' ? 'Geen' : '—')

  const tooltip = useMemo(() => {
    if (!regel) return ''
    if (regel.bron === 'afhalen') return 'Order op afhalen — geen vervoerder'
    if (regel.bron === 'override') return `Handmatige override op deze regel: ${labelText}`
    if (regel.bron === 'regel') {
      const u = (regel.uitleg ?? {}) as Record<string, unknown>
      const note = typeof u.match_notitie === 'string' ? u.match_notitie : null
      return `Regel-keuze: ${labelText}${note ? ` — ${note}` : ''}`
    }
    if (regel.bron === 'klant_fallback') return `Klant-fallback: ${labelText}`
    return 'Geen vervoerder gekozen'
  }, [regel, labelText])

  if (!regel) {
    return <span className="text-[10px] text-slate-300">—</span>
  }

  function handleKies(code: string | null) {
    setError(null)
    update.mutate(
      { orderregelId, vervoerderCode: code },
      {
        onSuccess: () => setOpen(false),
        onError: (e: unknown) => {
          if (e instanceof Error) setError(e.message)
          else setError('Wijzigen mislukt')
        },
      },
    )
  }

  const BronIcon =
    regel.bron === 'override'
      ? User
      : regel.bron === 'regel'
        ? Sparkles
        : Truck

  const dropdown =
    open && !locked && regel.bron !== 'afhalen' && pos
      ? createPortal(
          <div
            ref={popoverRef}
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: DROPDOWN_BREEDTE }}
            className="z-[100] rounded-[var(--radius-sm)] border border-slate-200 bg-white py-1 text-xs shadow-lg"
          >
            <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wide text-slate-400">
              Override voor deze regel
            </div>
            {vervoerders.map((v) => {
              const isHuidig = regel.override_code === v.code
              const vDef = getVervoerderDef(v.code)
              return (
                <button
                  key={v.code}
                  onClick={() => handleKies(v.code)}
                  disabled={!v.actief}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 ${
                    isHuidig ? 'bg-slate-50 font-medium' : ''
                  }`}
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      vDef ? DOT_STYLES[vDef.badgeKleur] : DOT_STYLES.grijs
                    }`}
                  />
                  <span className="flex-1">{v.display_naam}</span>
                  {!v.actief && <span className="text-[10px] text-slate-400">inactief</span>}
                </button>
              )
            })}
            <div className="my-1 border-t border-slate-100" />
            <button
              onClick={() => handleKies(null)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50 ${
                regel.override_code === null ? 'bg-slate-50 font-medium' : ''
              }`}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300" />
              <span className="flex-1 text-slate-500">Volg order-default</span>
            </button>
            {error && (
              <div className="mt-1 border-t border-rose-100 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700">
                {error}
              </div>
            )}
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (locked || regel.bron === 'afhalen') return
          setOpen((v) => !v)
        }}
        disabled={update.isPending || locked || regel.bron === 'afhalen'}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${KLEUR_STYLES[labelKleur]} disabled:opacity-70 ${
          locked || regel.bron === 'afhalen' ? 'cursor-default' : 'cursor-pointer'
        }`}
        title={locked ? `Vergrendeld — er bestaat al een zending voor deze regel. ${tooltip}` : tooltip}
      >
        {update.isPending ? (
          <Loader2 size={10} className="animate-spin" />
        ) : locked ? (
          <Lock size={10} />
        ) : (
          <BronIcon size={10} />
        )}
        {labelText}
        {!locked && regel.bron !== 'afhalen' && <ChevronDown size={9} className="opacity-60" />}
      </button>
      {dropdown}
    </>
  )
}
