import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ChevronDown, X } from 'lucide-react'
import {
  useCreateVerzendregel,
  useUpdateVerzendregel,
} from '@/modules/logistiek/hooks/use-verzendregels'
import type {
  Verzendregel,
  VerzendregelConditie,
} from '@/modules/logistiek/queries/verzendregels'
import type { Vervoerder } from '@/modules/logistiek/queries/vervoerders'
import { useAuth } from '@/hooks/use-auth'

interface Props {
  open: boolean
  onClose: () => void
  vervoerders: Vervoerder[]
  target: Verzendregel | null
  /**
   * Optionele land-voorvulling voor "+ Regel toevoegen voor [land]" knoppen
   * vanuit de land-eerst lijst. Genegeerd in edit-mode (target wint).
   */
  prefillLand?: string | null
}

const inputClass =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

export function VerzendregelDialog({
  open,
  onClose,
  vervoerders,
  target,
  prefillLand = null,
}: Props) {
  // Externe vertegenwoordiger (mig 489): read-only — geen aanmaak/bewerk-dialoog.
  const { isExternRep } = useAuth()
  const isEdit = Boolean(target)

  const [vervoerderCode, setVervoerderCode] = useState('')
  const [prio, setPrio] = useState('100')
  const [actief, setActief] = useState(true)
  const [serviceCode, setServiceCode] = useState('')
  const [notitie, setNotitie] = useState('')

  const [land, setLand] = useState('')
  const [kleinsteZijdeMin, setKleinsteZijdeMin] = useState('')
  const [kleinsteZijdeMax, setKleinsteZijdeMax] = useState('')
  const [gewichtMin, setGewichtMin] = useState('')
  const [gewichtMax, setGewichtMax] = useState('')
  const [debiteurNrs, setDebiteurNrs] = useState('')
  const [inkoopgroepCodes, setInkoopgroepCodes] = useState('')

  const [geavanceerdOpen, setGeavanceerdOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createMut = useCreateVerzendregel()
  const updateMut = useUpdateVerzendregel()

  const beschikbareServiceCodes = useMemo(() => {
    const v = vervoerders.find((x) => x.code === vervoerderCode)
    return v?.service_codes ?? []
  }, [vervoerders, vervoerderCode])

  useEffect(() => {
    if (!open) return
    if (target) {
      setVervoerderCode(target.vervoerder_code)
      setPrio(String(target.prio))
      setActief(target.actief)
      setServiceCode(target.service_code ?? '')
      setNotitie(target.notitie ?? '')
      setLand((target.conditie.land ?? []).join(', '))
      setKleinsteZijdeMin(numToStr(target.conditie.kleinste_zijde_cm_min))
      setKleinsteZijdeMax(numToStr(target.conditie.kleinste_zijde_cm_max))
      setGewichtMin(numToStr(target.conditie.gewicht_kg_min))
      setGewichtMax(numToStr(target.conditie.gewicht_kg_max))
      setDebiteurNrs((target.conditie.debiteur_nrs ?? []).join(', '))
      setInkoopgroepCodes((target.conditie.inkoopgroep_codes ?? []).join(', '))
      setGeavanceerdOpen(
        Boolean(
          (target.conditie.debiteur_nrs ?? []).length ||
            (target.conditie.inkoopgroep_codes ?? []).length,
        ),
      )
    } else {
      setVervoerderCode('')
      setPrio('100')
      setActief(true)
      setServiceCode('')
      setNotitie('')
      setLand(prefillLand ?? '')
      setKleinsteZijdeMin('')
      setKleinsteZijdeMax('')
      setGewichtMin('')
      setGewichtMax('')
      setDebiteurNrs('')
      setInkoopgroepCodes('')
      setGeavanceerdOpen(false)
    }
    setError(null)
  }, [open, target, prefillLand])

  function buildConditie(): VerzendregelConditie {
    const c: VerzendregelConditie = {}
    const landenArr = csvSplit(land)
    if (landenArr.length) c.land = landenArr.map((l) => l.toUpperCase())
    if (kleinsteZijdeMin.trim() !== '')
      c.kleinste_zijde_cm_min = Number(kleinsteZijdeMin)
    if (kleinsteZijdeMax.trim() !== '')
      c.kleinste_zijde_cm_max = Number(kleinsteZijdeMax)
    if (gewichtMin.trim() !== '') c.gewicht_kg_min = Number(gewichtMin)
    if (gewichtMax.trim() !== '') c.gewicht_kg_max = Number(gewichtMax)
    const debs = csvSplit(debiteurNrs)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n))
    if (debs.length) c.debiteur_nrs = debs
    const groepen = csvSplit(inkoopgroepCodes).map((s) => s.toUpperCase())
    if (groepen.length) c.inkoopgroep_codes = groepen
    return c
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!vervoerderCode) {
      setError('Kies een vervoerder')
      return
    }

    const prioNum = Number(prio)
    if (!Number.isFinite(prioNum)) {
      setError('Prio moet een getal zijn')
      return
    }

    const conditie = buildConditie()
    const payload = {
      vervoerder_code: vervoerderCode,
      prio: prioNum,
      conditie,
      service_code: serviceCode.trim() === '' ? null : serviceCode.trim(),
      actief,
      notitie: notitie.trim() === '' ? null : notitie.trim(),
    }

    try {
      if (isEdit && target) {
        await updateMut.mutateAsync({ id: target.id, patch: payload })
      } else {
        await createMut.mutateAsync(payload)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Er ging iets mis')
    }
  }

  if (!open || isExternRep) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white">
          <h2 className="font-medium text-lg">
            {isEdit ? 'Verzendregel bewerken' : 'Nieuwe verzendregel'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <Field label="Land(en)" hint="Komma-gescheiden ISO-codes (NL, BE, DE). Leeg = geldt voor alle landen.">
            <input
              type="text"
              value={land}
              onChange={(e) => setLand(e.target.value)}
              className={inputClass}
              placeholder="DE"
              autoFocus={!isEdit && !prefillLand}
            />
          </Field>

          <Field label="Vervoerder">
            <select
              value={vervoerderCode}
              onChange={(e) => {
                setVervoerderCode(e.target.value)
                setServiceCode('')
              }}
              className={inputClass}
              required
            >
              <option value="">— kies vervoerder —</option>
              {vervoerders.map((v) => (
                <option key={v.code} value={v.code} disabled={!v.actief}>
                  {v.display_naam}
                  {!v.actief ? ' (inactief)' : ''}
                </option>
              ))}
            </select>
          </Field>

          {beschikbareServiceCodes.length > 0 && (
            <Field label="Service-variant" hint="Bv. 'internationaal' of 'predict'.">
              <select
                value={serviceCode}
                onChange={(e) => setServiceCode(e.target.value)}
                className={inputClass}
              >
                <option value="">— vervoerder-default —</option>
                {beschikbareServiceCodes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-500 mb-3">
              Optionele filters — leeg laten betekent: geldt voor alle zendingen onder dit
              land.
            </p>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <Field label="Gewicht min (kg)">
                <input
                  type="number"
                  step="0.1"
                  value={gewichtMin}
                  onChange={(e) => setGewichtMin(e.target.value)}
                  className={inputClass}
                  placeholder="—"
                />
              </Field>
              <Field label="Gewicht max (kg)">
                <input
                  type="number"
                  step="0.1"
                  value={gewichtMax}
                  onChange={(e) => setGewichtMax(e.target.value)}
                  className={inputClass}
                  placeholder="—"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Rol-lengte min (cm)" hint="= kleinste tapijtzijde">
                <input
                  type="number"
                  value={kleinsteZijdeMin}
                  onChange={(e) => setKleinsteZijdeMin(e.target.value)}
                  className={inputClass}
                  placeholder="—"
                />
              </Field>
              <Field label="Rol-lengte max (cm)" hint="= kleinste tapijtzijde">
                <input
                  type="number"
                  value={kleinsteZijdeMax}
                  onChange={(e) => setKleinsteZijdeMax(e.target.value)}
                  className={inputClass}
                  placeholder="—"
                />
              </Field>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setGeavanceerdOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              <ChevronDown
                size={14}
                className={`transition-transform ${geavanceerdOpen ? 'rotate-180' : ''}`}
              />
              Geavanceerd (klant- en inkoopgroep-targeting)
            </button>

            {geavanceerdOpen && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="Inkoopgroep(en)" hint="Komma-gescheiden codes">
                  <input
                    type="text"
                    value={inkoopgroepCodes}
                    onChange={(e) => setInkoopgroepCodes(e.target.value)}
                    className={inputClass}
                    placeholder="BEGROS, INTERRING"
                  />
                </Field>
                <Field label="Debiteur-nummer(s)" hint="Komma-gescheiden">
                  <input
                    type="text"
                    value={debiteurNrs}
                    onChange={(e) => setDebiteurNrs(e.target.value)}
                    className={inputClass}
                    placeholder="123456, 234567"
                  />
                </Field>
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 pt-3 grid grid-cols-2 gap-3 items-end">
            <Field label="Prio" hint="Laag = eerst geëvalueerd. Specifieke regels lagere prio dan generieke.">
              <input
                type="number"
                value={prio}
                onChange={(e) => setPrio(e.target.value)}
                className={inputClass}
                required
              />
            </Field>
            <label className="inline-flex items-center gap-2 text-sm pb-2">
              <input
                type="checkbox"
                checked={actief}
                onChange={(e) => setActief(e.target.checked)}
                className="rounded border-slate-300 text-terracotta-600 focus:ring-terracotta-400/30"
              />
              <span className="text-slate-700">Regel actief</span>
            </label>
          </div>

          <Field label="Notitie (optioneel)">
            <input
              type="text"
              value={notitie}
              onChange={(e) => setNotitie(e.target.value)}
              className={inputClass}
              placeholder="Korte uitleg waarom deze regel bestaat."
            />
          </Field>

          {error && <div className="text-xs text-rose-600">{error}</div>}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-[var(--radius-sm)] text-sm font-medium border border-slate-200 text-slate-600 bg-white hover:bg-slate-50"
            >
              Annuleren
            </button>
            <button
              type="submit"
              disabled={createMut.isPending || updateMut.isPending}
              className="px-4 py-2 rounded-[var(--radius-sm)] text-sm font-medium bg-terracotta-600 text-white hover:bg-terracotta-700 disabled:opacity-50"
            >
              {createMut.isPending || updateMut.isPending
                ? 'Opslaan…'
                : isEdit
                  ? 'Opslaan'
                  : 'Toevoegen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: React.ReactNode
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-slate-400 mt-1">{hint}</div>}
    </div>
  )
}

function csvSplit(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

function numToStr(v: number | null | undefined): string {
  return v == null ? '' : String(v)
}
