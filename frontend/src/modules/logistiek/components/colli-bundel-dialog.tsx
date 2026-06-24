import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, Printer, Undo2, X } from 'lucide-react'
import {
  useMaakColliBundel,
  useVerwijderColliBundel,
  useZendingColliVoorBundel,
} from '@/modules/logistiek/hooks/use-colli-bundel'
import {
  bundelOpPallet,
  isFootprintPallet,
  palletFootprint,
  palletTypeOpties,
  RHENUS_GEEN_PALLET,
} from '@/modules/logistiek/lib/handmatig-aanmelden'
import { useAuth } from '@/hooks/use-auth'

interface Props {
  zendingId: number
  zendingNr: string
  /** Stuurt de bundel-eenheid + pallet-type-opties: HST → EP/SP (mig 485),
   *  Rhenus → PLTS/HPLT (mig 489). Beide bundelen op een pallet. */
  vervoerderCode: string | null
  onClose: () => void
}

/**
 * Pop-up om colli te bundelen tijdens (of net na) de pickronde — mig 421/485/489.
 * Selecteer ≥2 colli → één nieuwe SSCC-sticker (de bundel) op een pallet, en kies
 * het pallet-type (HST: EP/SP; Rhenus: volle/halve pallet). Aanmelden zit hier
 * bewust NIET: HST meldt direct na 'Voltooi pickronde' aan, Rhenus in de dagbatch
 * om 16:00. Hergebruikt de bundel-hooks van zending-detail.
 */
export function ColliBundelDialog({ zendingId, zendingNr, vervoerderCode, onClose }: Props) {
  const { data: colli = [], isLoading } = useZendingColliVoorBundel(zendingId)
  const maak = useMaakColliBundel(zendingId)
  const verwijder = useVerwijderColliBundel(zendingId)
  // Externe vertegenwoordiger (mig 489): read-only — geen colli-bundeling.
  const { isExternRep } = useAuth()

  const metPallet = bundelOpPallet(vervoerderCode)
  const palletOpties = palletTypeOpties(vervoerderCode)
  const eenheid = metPallet ? 'pallet' : 'zak'

  const [geselecteerd, setGeselecteerd] = useState<Set<number>>(new Set())
  const [palletType, setPalletType] = useState<string>('')
  const [gewicht, setGewicht] = useState('')
  const [lengte, setLengte] = useState('')
  const [breedte, setBreedte] = useState('')
  const [hoogte, setHoogte] = useState('')

  // Een echte pallet (PLTS/HPLT) → footprint-prefill voor lengte/breedte + laadhoogte-veld.
  const isPallet = isFootprintPallet(palletType)

  const losseColli = colli.filter((c) => !c.is_bundel && c.bundel_colli_id == null)
  const bundels = colli.filter((c) => c.is_bundel)
  const kinderenVan = (bundelId: number) => colli.filter((c) => c.bundel_colli_id === bundelId)

  // Voorgevulde maten/gewicht uit de selectie (Σ gewicht, MAX maat).
  const defaults = useMemo(() => {
    const sel = colli.filter((c) => geselecteerd.has(c.id))
    return {
      gewicht: sel.reduce((s, c) => s + (c.gewicht_kg ?? 0), 0),
      lengte: sel.reduce((m, c) => Math.max(m, c.lengte_cm ?? 0), 0),
      breedte: sel.reduce((m, c) => Math.max(m, c.breedte_cm ?? 0), 0),
    }
  }, [colli, geselecteerd])

  if (isExternRep) return null

  // Bij een pallet moet een type gekozen zijn (HST weigert een onbekende
  // PackageUnitID; Rhenus heeft de zak-optie als expliciete keuze).
  const kanBundelen = geselecteerd.size >= 2 && (!metPallet || palletType !== '')

  function reset() {
    setGewicht(''); setLengte(''); setBreedte(''); setHoogte('')
  }

  function toggle(id: number) {
    setGeselecteerd((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    reset()
  }

  // Pallet-type kiezen: prefill lengte/breedte met de footprint (PLTS 80×120 /
  // HPLT 80×60); zak/EP/SP → leeg laten (placeholder = MAX-van-selectie).
  function kiesType(value: string) {
    setPalletType(value)
    const fp = palletFootprint(value)
    if (fp) {
      setLengte(String(fp.lengteCm))
      setBreedte(String(fp.breedteCm))
    } else {
      setLengte(''); setBreedte('')
    }
  }

  function bundel() {
    maak.mutate(
      {
        colliIds: [...geselecteerd],
        gewichtKg: parseOrDefault(gewicht, defaults.gewicht),
        lengteCm: parseOrDefault(lengte, defaults.lengte),
        breedteCm: parseOrDefault(breedte, defaults.breedte),
        // 'ZAK'-sentinel (Rhenus geen-pallet) → pallet_type NULL (RLEN).
        palletType: !metPallet || palletType === RHENUS_GEEN_PALLET ? null : palletType,
        // Laadhoogte alleen bij een echte pallet (operator-invoer, optioneel).
        hoogteCm: isPallet ? parseOptional(hoogte) : null,
      },
      {
        onSuccess: () => {
          setGeselecteerd(new Set())
          setPalletType('')
          reset()
        },
      },
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius)] bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Boxes size={16} className="text-terracotta-600" /> Colli bundelen — {zendingNr}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Sluiten">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <p className="mb-3 text-xs text-slate-500">
            Pak een paar colli samen op één {eenheid}: vink ze aan
            {metPallet ? <>, kies het <strong>pallet-type</strong></> : null} →{' '}
            <strong>Bundel maken</strong> → print de nieuwe sticker en plak die op de {eenheid}. De losse
            stickers eronder gooi je weg. Aanmelden bij de vervoerder gebeurt later, bij{' '}
            <strong>Voltooi pickronde</strong>.
          </p>

          {isLoading ? (
            <div className="text-sm text-slate-400">Colli laden…</div>
          ) : (
            <>
              {/* Bestaande bundels */}
              {bundels.length > 0 && (
                <div className="mb-4 space-y-2">
                  {bundels.map((b) => (
                    <div key={b.id} className="rounded-[var(--radius-sm)] border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-slate-700">
                          {b.klant_omschrijving_snapshot ?? 'Bundel'}{' '}
                          <span className="font-mono text-xs text-slate-500">{b.sscc}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Link
                            to={`/logistiek/${zendingNr}/printset?colli=${b.colli_nr}`}
                            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                          >
                            <Printer size={13} /> Bundelsticker
                          </Link>
                          <button
                            onClick={() => verwijder.mutate(b.id)}
                            disabled={verwijder.isPending}
                            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                          >
                            <Undo2 size={13} /> Ontbundelen
                          </button>
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {kinderenVan(b.id).map((k) => k.omschrijving_snapshot ?? `Colli ${k.colli_nr}`).join(' · ')}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Losse colli met checkboxes */}
              <div className="space-y-1.5">
                {losseColli.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={geselecteerd.has(c.id)}
                      onChange={() => toggle(c.id)}
                    />
                    <span className="w-8 font-mono text-xs text-slate-400">#{c.colli_nr}</span>
                    <span className="flex-1">{c.omschrijving_snapshot ?? `Colli ${c.colli_nr}`}</span>
                    <span className="text-xs text-slate-400">
                      {c.gewicht_kg != null ? `${c.gewicht_kg} kg` : '—'}
                    </span>
                  </label>
                ))}
                {losseColli.length === 0 && (
                  <div className="text-sm text-slate-400">Geen losse colli meer om te bundelen.</div>
                )}
              </div>

              {/* Bundel-formulier (≥2 geselecteerd) */}
              {geselecteerd.size >= 2 && (
                <div className="mt-4 rounded-[var(--radius-sm)] border border-slate-200 p-3">
                  <div className="mb-2 text-xs font-semibold text-slate-600">
                    {geselecteerd.size} colli bundelen — controleer gewicht/maat van de {palletType === RHENUS_GEEN_PALLET ? 'zak' : eenheid}:
                  </div>
                  {metPallet && (
                    <div className="mb-3">
                      <div className="mb-1 text-xs text-slate-500">Pallet-type</div>
                      <div className="flex flex-wrap gap-2">
                        {palletOpties.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => kiesType(opt.value)}
                            className={`rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm font-medium ${
                              palletType === opt.value
                                ? 'border-terracotta-600 bg-terracotta-50 text-terracotta-700'
                                : 'border-slate-300 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-end gap-3">
                    <MaatVeld label="Gewicht (kg)" value={gewicht} ph={String(round1(defaults.gewicht))} onChange={setGewicht} />
                    <MaatVeld label="Lengte (cm)" value={lengte} ph={String(defaults.lengte)} onChange={setLengte} />
                    <MaatVeld label="Breedte (cm)" value={breedte} ph={String(defaults.breedte)} onChange={setBreedte} />
                    {isPallet && (
                      <MaatVeld label="Hoogte (cm)" value={hoogte} ph="hoogte" onChange={setHoogte} />
                    )}
                    <button
                      onClick={bundel}
                      disabled={!kanBundelen || maak.isPending}
                      title={metPallet && palletType === '' ? 'Kies eerst een pallet-type' : undefined}
                      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-terracotta-600 px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-700 disabled:opacity-50"
                    >
                      <Boxes size={15} /> Bundel maken
                    </button>
                  </div>
                </div>
              )}

              {maak.isError && (
                <div className="mt-2 text-xs text-rose-600">Bundelen mislukt: {(maak.error as Error).message}</div>
              )}
              {verwijder.isError && (
                <div className="mt-2 text-xs text-rose-600">Ontbundelen mislukt: {(verwijder.error as Error).message}</div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-[var(--radius-sm)] border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Klaar
          </button>
        </div>
      </div>
    </div>
  )
}

function MaatVeld({
  label, value, ph, onChange,
}: { label: string; value: string; ph: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-500">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        placeholder={ph}
        onChange={(e) => onChange(e.target.value)}
        className="w-28 rounded-[var(--radius-sm)] border border-slate-300 px-2 py-1.5 text-sm"
      />
    </div>
  )
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function parseOrDefault(s: string, d: number): number {
  const n = parseFloat(s)
  return Number.isNaN(n) ? d : n
}

// Leeg/ongeldig → null (optioneel veld, bv. laadhoogte).
function parseOptional(s: string): number | null {
  const n = parseFloat(s)
  return Number.isNaN(n) ? null : n
}
