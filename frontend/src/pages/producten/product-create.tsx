import { useState, useEffect, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useLeveranciers, useCreateProduct, useNextArtikelnr } from '@/hooks/use-producten'
import {
  fetchAfwerkingTypes,
  fetchStandaardAfwerking,
  fetchAfwerkingVoorKleur,
  setStandaardAfwerking,
  setAfwerkingVoorKleur,
} from '@/modules/maatwerk'
import { fetchKwaliteitBestaat } from '@/lib/supabase/queries/producten'
import type { ProductType } from '@/lib/supabase/queries/producten'

const PRODUCT_TYPES: { value: ProductType; label: string }[] = [
  { value: 'vast', label: 'Standaard maat' },
  { value: 'rol', label: 'Rol' },
  { value: 'staaltje', label: 'Staal' },
  { value: 'overig', label: 'Overig' },
]

interface VariantRow {
  _key: number
  artikelnr: string
  product_type: ProductType | ''
  breedte: string
  lengte: string
  karpi_code: string
  ean_code: string
  verkoopprijs: string
  inkoopprijs: string
  gewicht_kg: string
  voorraad: string
  locatie: string
}

let _seq = 0
const newRow = (): VariantRow => ({
  _key: ++_seq,
  artikelnr: '',
  product_type: '',
  breedte: '',
  lengte: '',
  karpi_code: '',
  ean_code: '',
  verkoopprijs: '',
  inkoopprijs: '',
  gewicht_kg: '',
  voorraad: '0',
  locatie: '',
})

function buildOmschrijving(naam: string, kleurCode: string, breedte: string, lengte: string) {
  const parts = [naam.trim()]
  if (kleurCode.trim()) parts.push(`Kleur ${kleurCode.trim()}`)
  if (breedte && lengte) parts.push(`${breedte}x${lengte}cm`)
  return parts.join(' ')
}

/**
 * Karpi-code conventie: {KWALITEIT}{KLEUR:2}XX{BREEDTE:3}{LENGTE:3}
 * Voorbeeld: FAMU48XX160230
 */
function buildKarpiCode(kwaliteit: string, kleur: string, breedte: string, lengte: string) {
  const k = (kwaliteit || '').trim().toUpperCase()
  const klr = (kleur || '').trim()
  if (!k || !klr || !breedte) return ''
  const klrPad = klr.padStart(2, '0').slice(0, 2)
  const w = String(parseInt(breedte, 10) || 0).padStart(3, '0').slice(-3)
  const lTrim = (lengte || '').trim()
  const l = lTrim ? String(parseInt(lTrim, 10) || 0).padStart(3, '0').slice(-3) : ''
  if (!l) return ''
  return `${k}${klrPad}XX${w}${l}`
}

export function ProductCreatePage() {
  const navigate = useNavigate()
  const { data: leveranciers } = useLeveranciers()
  const createMutation = useCreateProduct()

  // Stamgegevens
  const [naam, setNaam] = useState('')
  const [kwaliteitCode, setKwaliteitCode] = useState('')
  const [kwaliteitCodeInput, setKwaliteitCodeInput] = useState('')  // ruwe invoer (vóór uppercase)
  const [kleurCode, setKleurCode] = useState('')
  const [leverancierId, setLeverancierId] = useState<string>('')
  const [afwerkingCode, setAfwerkingCode] = useState('')
  const [actief, setActief] = useState(false)

  // Varianten
  const [rows, setRows] = useState<VariantRow[]>([newRow()])
  const [manualArtikelnr, setManualArtikelnr] = useState<Set<number>>(new Set())
  const [manualKarpi, setManualKarpi] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)

  // Debounced kwaliteitscode voor duplicate-check
  const [debouncedKwaliteit, setDebouncedKwaliteit] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKwaliteit(kwaliteitCode), 400)
    return () => clearTimeout(timer)
  }, [kwaliteitCode])

  // Duplicate check
  const { data: kwaliteitBestaat, isFetching: checkingDuplicate } = useQuery({
    queryKey: ['kwaliteit-bestaat', debouncedKwaliteit],
    queryFn: () => fetchKwaliteitBestaat(debouncedKwaliteit),
    enabled: debouncedKwaliteit.length >= 2,
  })

  // Afwerking-types
  const { data: afwerkingTypes } = useQuery({
    queryKey: ['afwerking-types'],
    queryFn: fetchAfwerkingTypes,
  })

  // Standaard afwerking ophalen bij kwaliteit/kleur combo
  useEffect(() => {
    let cancelled = false
    if (!kwaliteitCode) {
      setAfwerkingCode('')
      return
    }
    ;(async () => {
      const perKleur = kleurCode.trim()
        ? await fetchAfwerkingVoorKleur(kwaliteitCode, kleurCode.trim())
        : null
      const code = perKleur ?? (await fetchStandaardAfwerking(kwaliteitCode))
      if (!cancelled) setAfwerkingCode(code ?? '')
    })()
    return () => { cancelled = true }
  }, [kwaliteitCode, kleurCode])

  // Volgend artikelnr op basis van kwaliteit+kleur
  const { data: nextArtikelnr } = useNextArtikelnr(
    kwaliteitCode || null,
    kleurCode.trim() || null,
  )

  // Auto-fill artikelnr en karpi-code per rij
  useEffect(() => {
    setRows(rs => rs.map((r, idx) => {
      const next: VariantRow = { ...r }
      if (!manualArtikelnr.has(r._key) && nextArtikelnr) {
        const base = parseInt(nextArtikelnr, 10)
        if (!Number.isNaN(base)) {
          next.artikelnr = String(base + idx).padStart(9, '0')
        }
      }
      if (!manualKarpi.has(r._key)) {
        next.karpi_code = buildKarpiCode(kwaliteitCode, kleurCode, r.breedte, r.lengte)
      }
      return next
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextArtikelnr, kwaliteitCode, kleurCode])

  function handleKwaliteitInput(raw: string) {
    const upper = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
    setKwaliteitCodeInput(upper)
    setKwaliteitCode(upper)
  }

  function updateRow(key: number, field: keyof VariantRow, value: string) {
    setRows(rs => rs.map(r => {
      if (r._key !== key) return r
      const next = { ...r, [field]: value }
      if ((field === 'breedte' || field === 'lengte') && !manualKarpi.has(key)) {
        next.karpi_code = buildKarpiCode(kwaliteitCode, kleurCode, next.breedte, next.lengte)
      }
      return next
    }))
    if (field === 'artikelnr') {
      setManualArtikelnr(prev => { const s = new Set(prev); s.add(key); return s })
    } else if (field === 'karpi_code') {
      setManualKarpi(prev => { const s = new Set(prev); s.add(key); return s })
    }
  }

  function addRow() {
    const r = newRow()
    if (nextArtikelnr) {
      const base = parseInt(nextArtikelnr, 10)
      if (!Number.isNaN(base)) {
        r.artikelnr = String(base + rows.length).padStart(9, '0')
      }
    }
    setRows(rs => [...rs, r])
  }

  function removeRow(key: number) {
    setRows(rs => rs.filter(r => r._key !== key))
    setManualArtikelnr(prev => { const s = new Set(prev); s.delete(key); return s })
    setManualKarpi(prev => { const s = new Set(prev); s.delete(key); return s })
  }

  const filledRows = useMemo(() => rows.filter(r => r.artikelnr.trim()), [rows])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (filledRows.length === 0) {
      setError('Voeg minimaal één variant toe met een artikelnummer.')
      return
    }
    // Mig 359: karpi_code is verplicht voor rol/vast (DB-trigger weigert
    // anders). Optioneel voor overig/staaltje (banden/calibra/staaltjes).
    const zonderKarpi = filledRows.filter(
      r => (r.product_type === 'rol' || r.product_type === 'vast') && !r.karpi_code.trim()
    )
    if (zonderKarpi.length > 0) {
      setError(`Karpi-code is verplicht voor producten van type Rol of Standaard maat. Vul de Karpi-code in bij: ${zonderKarpi.map(r => r.artikelnr.trim()).join(', ')}.`)
      return
    }
    if (kwaliteitBestaat) {
      setError(`Kwaliteitscode "${kwaliteitCode}" bestaat al in de database. Gebruik een andere code of koppel het product aan de bestaande kwaliteit via het productdetail-scherm.`)
      return
    }

    try {
      for (const r of filledRows) {
        await createMutation.mutateAsync({
          artikelnr: r.artikelnr.trim(),
          karpi_code: r.karpi_code.trim() || null,
          ean_code: r.ean_code.trim() || null,
          omschrijving: buildOmschrijving(naam, kleurCode, r.breedte, r.lengte),
          kwaliteit_code: kwaliteitCode || null,
          kleur_code: kleurCode.trim() || null,
          product_type: (r.product_type as ProductType) || null,
          verkoopprijs: r.verkoopprijs ? Number(r.verkoopprijs) : null,
          inkoopprijs: r.inkoopprijs ? Number(r.inkoopprijs) : null,
          gewicht_kg: r.gewicht_kg ? Number(r.gewicht_kg) : null,
          voorraad: 0,
          locatie: r.locatie.trim() || null,
          leverancier_id: leverancierId ? Number(leverancierId) : null,
          actief,
        })
      }

      if (afwerkingCode && kwaliteitCode) {
        if (kleurCode.trim()) {
          await setAfwerkingVoorKleur(kwaliteitCode, kleurCode.trim(), afwerkingCode)
        } else {
          await setStandaardAfwerking(kwaliteitCode, afwerkingCode)
        }
      }

      navigate(`/producten/${filledRows[0].artikelnr.trim()}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Er is een fout opgetreden')
    }
  }

  const isPending = createMutation.isPending

  return (
    <>
      <div className="mb-4">
        <Link to="/producten" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
          <ArrowLeft size={14} /> Terug naar producten
        </Link>
      </div>

      <PageHeader title="Nieuw product aanmaken" />

      <form onSubmit={handleSubmit} className="mt-6 space-y-6 max-w-6xl">

        {/* ── Sectie 1: Stamgegevens ─────────────────────────────── */}
        <section className="bg-white rounded-[var(--radius)] border-2 border-slate-200 shadow-sm">
          <div className="px-6 py-4 border-b-2 border-slate-100 bg-slate-50 rounded-t-[var(--radius)]">
            <h3 className="font-semibold text-slate-800 text-base">Stamgegevens</h3>
            <p className="text-xs text-slate-500 mt-0.5">Gemeenschappelijk voor alle varianten van dit product</p>
          </div>
          <div className="p-6 grid grid-cols-2 gap-x-8 gap-y-5">

            {/* Naam */}
            <Field label="Productnaam *" hint="Bijv. FADED MUSCAT — zonder kleur of maat">
              <input
                required
                value={naam}
                onChange={e => setNaam(e.target.value)}
                className="input"
                placeholder="bijv. FADED MUSCAT"
              />
            </Field>

            {/* Kwaliteitscode — nieuw, vrije invoer met duplicate-check */}
            <Field
              label="Kwaliteitscode (nieuw)"
              hint="Dit is de unieke code voor deze kwaliteitslijn — tevens prefix van de Karpi-code"
            >
              <div className="relative">
                <input
                  value={kwaliteitCodeInput}
                  onChange={e => handleKwaliteitInput(e.target.value)}
                  className={`input pr-9 font-mono tracking-wider ${kwaliteitBestaat ? 'input-error' : kwaliteitCode.length >= 2 && !checkingDuplicate && !kwaliteitBestaat ? 'border-emerald-400 focus:border-emerald-400' : ''}`}
                  placeholder="bijv. FAMU"
                  maxLength={10}
                  autoComplete="off"
                  spellCheck={false}
                />
                {/* Status icoon rechts in het veld */}
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                  {checkingDuplicate && kwaliteitCode.length >= 2 && (
                    <span className="inline-block w-4 h-4 border-2 border-slate-300 border-t-terracotta-400 rounded-full animate-spin" />
                  )}
                  {!checkingDuplicate && kwaliteitBestaat && (
                    <AlertTriangle size={16} className="text-rose-500" />
                  )}
                  {!checkingDuplicate && kwaliteitCode.length >= 2 && kwaliteitBestaat === false && (
                    <CheckCircle2 size={16} className="text-emerald-500" />
                  )}
                </span>
              </div>

              {/* Feedback onder het veld */}
              {!checkingDuplicate && kwaliteitBestaat === true && (
                <p className="mt-1.5 text-xs text-rose-600 flex items-center gap-1.5">
                  <AlertTriangle size={12} />
                  Kwaliteitscode <strong>{kwaliteitCode}</strong> bestaat al in de database. Kies een andere code.
                </p>
              )}
              {!checkingDuplicate && kwaliteitCode.length >= 2 && kwaliteitBestaat === false && (
                <p className="mt-1.5 text-xs text-emerald-600 flex items-center gap-1.5">
                  <CheckCircle2 size={12} />
                  Code beschikbaar — nieuwe kwaliteit wordt aangemaakt.
                </p>
              )}
              {kwaliteitCode.length === 0 && (
                <p className="mt-1.5 text-xs text-slate-400 flex items-center gap-1.5">
                  <Info size={12} />
                  Bijv. FAMU, VELV, OASI — wordt ook de prefix van alle Karpi-codes voor dit product.
                </p>
              )}
            </Field>

            {/* Kleurcode */}
            <Field label="Kleurcode" hint="Cijfer uit het kleurboek van de leverancier, bijv. 48">
              <input
                value={kleurCode}
                onChange={e => setKleurCode(e.target.value)}
                className="input"
                placeholder="bijv. 48"
              />
            </Field>

            {/* Leverancier */}
            <Field label="Leverancier">
              <select
                value={leverancierId}
                onChange={e => setLeverancierId(e.target.value)}
                className="input"
              >
                <option value="">— geen —</option>
                {leveranciers?.map(l => (
                  <option key={l.id} value={l.id}>{l.naam}</option>
                ))}
              </select>
            </Field>

            {/* Maatwerk afwerking */}
            <Field
              label="Maatwerk afwerking"
              hint={
                kwaliteitCode
                  ? kleurCode.trim()
                    ? 'Opgeslagen als afwerking voor deze kwaliteit + kleur.'
                    : 'Opgeslagen als standaard afwerking voor deze kwaliteit.'
                  : 'Vul eerst een kwaliteitscode in.'
              }
            >
              <select
                value={afwerkingCode}
                onChange={e => setAfwerkingCode(e.target.value)}
                className="input"
                disabled={!kwaliteitCode}
              >
                <option value="">— geen —</option>
                {afwerkingTypes?.map(a => (
                  <option key={a.code} value={a.code}>{a.code} – {a.naam}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Actief checkbox */}
          <div className="px-6 pb-5 border-t border-slate-100 pt-4">
            <label className="flex items-start gap-3 cursor-pointer w-fit">
              <input
                type="checkbox"
                checked={actief}
                onChange={e => setActief(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded accent-terracotta-500"
              />
              <div>
                <span className="text-sm font-medium text-slate-700">Actief (zichtbaar in systeem)</span>
                <p className="text-xs text-slate-400 mt-0.5">
                  Standaard inactief: nieuw product wordt pas zichtbaar in selectors zodra de eerste inkoop is ontvangen.
                </p>
              </div>
            </label>
          </div>
        </section>

        {/* ── Sectie 2: Varianten / Maten ────────────────────────── */}
        <section className="bg-white rounded-[var(--radius)] border-2 border-slate-200 shadow-sm">
          <div className="px-6 py-4 border-b-2 border-slate-100 bg-slate-50 rounded-t-[var(--radius)]">
            <h3 className="font-semibold text-slate-800 text-base">Varianten / Maten</h3>
            <p className="text-xs text-slate-500 mt-0.5">Elke rij wordt een apart artikel in het systeem</p>
          </div>
          <div className="p-6 space-y-4">
            {rows.map((r, idx) => {
              const karpiVerplicht = r.product_type === 'rol' || r.product_type === 'vast'
              return (
                <div
                  key={r._key}
                  className="rounded-[var(--radius-sm)] border border-slate-200 bg-slate-50/40 p-5"
                >
                  {/* Kaart-kop */}
                  <div className="flex items-center justify-between mb-4">
                    <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-terracotta-100 text-terracotta-600 text-[11px] font-bold">
                        {idx + 1}
                      </span>
                      Variant {idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRow(r._key)}
                      disabled={rows.length === 1}
                      className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-rose-500 disabled:opacity-20 disabled:hover:text-slate-400 transition-colors"
                      title="Verwijder deze variant"
                    >
                      <Trash2 size={14} /> Verwijderen
                    </button>
                  </div>

                  {/* Velden */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-4">
                    <VariantVeld label="Artikelnr *" className="col-span-2" hint="Automatisch — pas aan indien nodig">
                      <input
                        value={r.artikelnr}
                        onChange={e => updateRow(r._key, 'artikelnr', e.target.value)}
                        className="input w-full font-mono"
                        placeholder="298480000"
                      />
                    </VariantVeld>
                    <VariantVeld label="Type" className="col-span-2">
                      <select
                        value={r.product_type}
                        onChange={e => updateRow(r._key, 'product_type', e.target.value)}
                        className="input w-full"
                      >
                        <option value="">— kies type —</option>
                        {PRODUCT_TYPES.map(t => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </VariantVeld>

                    <VariantVeld label="Breedte cm">
                      <input
                        type="number" min="0"
                        value={r.breedte}
                        onChange={e => updateRow(r._key, 'breedte', e.target.value)}
                        className="input w-full"
                        placeholder="160"
                      />
                    </VariantVeld>
                    <VariantVeld label="Lengte cm">
                      <input
                        type="number" min="0"
                        value={r.lengte}
                        onChange={e => updateRow(r._key, 'lengte', e.target.value)}
                        className="input w-full"
                        placeholder="230"
                      />
                    </VariantVeld>
                    <VariantVeld
                      label={karpiVerplicht ? 'Karpi-code *' : 'Karpi-code'}
                      className="col-span-2"
                      hint={karpiVerplicht ? 'Verplicht voor Rol / Standaard maat' : 'Automatisch uit kwaliteit + kleur + maat'}
                    >
                      <input
                        value={r.karpi_code}
                        onChange={e => updateRow(r._key, 'karpi_code', e.target.value)}
                        required={karpiVerplicht}
                        className="input w-full font-mono"
                        placeholder="FAMU48XX160230"
                      />
                    </VariantVeld>

                    <VariantVeld label="Verkoop €">
                      <input
                        type="number" step="0.01" min="0"
                        value={r.verkoopprijs}
                        onChange={e => updateRow(r._key, 'verkoopprijs', e.target.value)}
                        className="input w-full"
                        placeholder="0,00"
                      />
                    </VariantVeld>
                    <VariantVeld label="Inkoop €">
                      <input
                        type="number" step="0.01" min="0"
                        value={r.inkoopprijs}
                        onChange={e => updateRow(r._key, 'inkoopprijs', e.target.value)}
                        className="input w-full"
                        placeholder="0,00"
                      />
                    </VariantVeld>
                    <VariantVeld label="Gewicht kg">
                      <input
                        type="number" step="0.01" min="0"
                        value={r.gewicht_kg}
                        onChange={e => updateRow(r._key, 'gewicht_kg', e.target.value)}
                        className="input w-full"
                        placeholder="0,00"
                      />
                    </VariantVeld>
                    <VariantVeld label="Voorraad" hint="Start op 0 — via inkoop-ontvangst">
                      <input
                        type="number"
                        value={0}
                        readOnly
                        disabled
                        className="input w-full bg-slate-100 text-slate-400"
                        title="Voorraad start op 0 — ophogen via boek-ontvangst op de inkooporder"
                      />
                    </VariantVeld>

                    <VariantVeld label="EAN" className="col-span-2">
                      <input
                        value={r.ean_code}
                        onChange={e => updateRow(r._key, 'ean_code', e.target.value)}
                        className="input w-full font-mono"
                        placeholder="8712345678901"
                      />
                    </VariantVeld>
                    <VariantVeld label="Locatie" className="col-span-2">
                      <input
                        value={r.locatie}
                        onChange={e => updateRow(r._key, 'locatie', e.target.value)}
                        className="input w-full"
                        placeholder="A3-12"
                      />
                    </VariantVeld>
                  </div>
                </div>
              )
            })}

            <button
              type="button"
              onClick={addRow}
              className="flex items-center gap-1.5 text-sm text-terracotta-500 hover:text-terracotta-600 font-medium transition-colors"
            >
              <Plus size={15} /> Maat / variant toevoegen
            </button>
          </div>
        </section>

        {/* ── Sectie 3: Preview ──────────────────────────────────── */}
        {naam.trim() && filledRows.length > 0 && (
          <section className="bg-slate-50 rounded-[var(--radius)] border-2 border-slate-200 p-5">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Voorbeeld — zo komen de artikelen in het systeem
            </p>
            <table className="text-sm w-full">
              <thead>
                <tr className="text-xs text-slate-400 border-b border-slate-200">
                  <th className="text-left font-normal pb-2 pr-6">Artikelnr</th>
                  <th className="text-left font-normal pb-2 pr-6">Omschrijving</th>
                  <th className="text-left font-normal pb-2 pr-6">Type</th>
                  <th className="text-right font-normal pb-2">Verkoop</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filledRows.map(r => (
                  <tr key={r._key}>
                    <td className="py-2 pr-6 font-mono text-xs text-slate-500">{r.artikelnr}</td>
                    <td className="py-2 pr-6 text-slate-800">
                      {buildOmschrijving(naam, kleurCode, r.breedte, r.lengte)}
                    </td>
                    <td className="py-2 pr-6 text-slate-500">
                      {PRODUCT_TYPES.find(t => t.value === r.product_type)?.label ?? '—'}
                    </td>
                    <td className="py-2 text-right text-slate-700">
                      {r.verkoopprijs ? `€ ${Number(r.verkoopprijs).toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {error && (
          <div className="flex items-start gap-3 text-sm text-rose-700 bg-rose-50 border-2 border-rose-200 rounded-[var(--radius-sm)] px-4 py-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* ── Acties ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 pb-8">
          <button
            type="submit"
            disabled={isPending || filledRows.length === 0 || kwaliteitBestaat === true}
            className="px-6 py-2.5 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50 transition-colors"
          >
            {isPending
              ? 'Opslaan...'
              : `${filledRows.length} artikel${filledRows.length !== 1 ? 'en' : ''} aanmaken`}
          </button>
          <Link
            to="/producten"
            className="px-6 py-2.5 border-2 border-slate-200 rounded-[var(--radius-sm)] text-sm text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Annuleren
          </Link>
          {kwaliteitBestaat === true && (
            <span className="text-xs text-rose-500 flex items-center gap-1.5">
              <AlertTriangle size={12} />
              Kies een andere kwaliteitscode om door te gaan.
            </span>
          )}
        </div>

      </form>
    </>
  )
}

/* ── Hulpcomponenten ───────────────────────────────────────── */

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

function VariantVeld({
  label,
  hint,
  className = '',
  children,
}: {
  label: string
  hint?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <label className="block text-[11px] font-semibold text-slate-500 mb-1 uppercase tracking-wide">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}
