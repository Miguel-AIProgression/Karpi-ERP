import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useKwaliteiten, useLeveranciers, useCreateProduct } from '@/hooks/use-producten'
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

export function ProductCreatePage() {
  const navigate = useNavigate()
  const { data: kwaliteiten } = useKwaliteiten()
  const { data: leveranciers } = useLeveranciers()
  const createMutation = useCreateProduct()

  // Familie / header velden
  const [naam, setNaam] = useState('')
  const [kwaliteitCode, setKwaliteitCode] = useState('')
  const [kleurCode, setKleurCode] = useState('')
  const [leverancierId, setLeverancierId] = useState<string>('')
  const [actief, setActief] = useState(true)

  // Varianten
  const [rows, setRows] = useState<VariantRow[]>([newRow()])
  const [error, setError] = useState<string | null>(null)

  function updateRow(key: number, field: keyof VariantRow, value: string) {
    setRows(rs => rs.map(r => r._key === key ? { ...r, [field]: value } : r))
  }

  function removeRow(key: number) {
    setRows(rs => rs.filter(r => r._key !== key))
  }

  const filledRows = rows.filter(r => r.artikelnr.trim())

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (filledRows.length === 0) {
      setError('Voeg minimaal één variant toe met een artikelnummer.')
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
          voorraad: r.voorraad ? Number(r.voorraad) : 0,
          locatie: r.locatie.trim() || null,
          leverancier_id: leverancierId ? Number(leverancierId) : null,
          actief,
        })
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
        <Link to="/producten" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> Terug naar producten
        </Link>
      </div>

      <PageHeader title="Nieuw product aanmaken" />

      <form onSubmit={handleSubmit} className="mt-6 space-y-6 max-w-6xl">

        {/* ── Sectie 1: Stamgegevens ─────────────────────────────── */}
        <section className="bg-white rounded-[var(--radius)] border border-slate-200">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Stamgegevens</h3>
            <p className="text-xs text-slate-500 mt-0.5">Gemeenschappelijk voor alle varianten van dit product</p>
          </div>
          <div className="p-6 grid grid-cols-2 gap-x-8 gap-y-4">
            <Field label="Naam *">
              <input
                required
                value={naam}
                onChange={e => setNaam(e.target.value)}
                className="input"
                placeholder="bijv. FADED MUSCAT"
              />
            </Field>
            <Field label="Kwaliteitscode">
              <select
                value={kwaliteitCode}
                onChange={e => setKwaliteitCode(e.target.value)}
                className="input"
              >
                <option value="">— geen —</option>
                {kwaliteiten?.map(k => (
                  <option key={k.code} value={k.code}>
                    {k.code}{k.omschrijving ? ` – ${k.omschrijving}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Kleurcode">
              <input
                value={kleurCode}
                onChange={e => setKleurCode(e.target.value)}
                className="input"
                placeholder="bijv. 48"
              />
            </Field>
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
          </div>
          <div className="px-6 pb-5">
            <label className="flex items-center gap-3 cursor-pointer w-fit">
              <input
                type="checkbox"
                checked={actief}
                onChange={e => setActief(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm text-slate-700">Actief (zichtbaar in systeem)</span>
            </label>
          </div>
        </section>

        {/* ── Sectie 2: Varianten / Maten ────────────────────────── */}
        <section className="bg-white rounded-[var(--radius)] border border-slate-200">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Varianten / Maten</h3>
            <p className="text-xs text-slate-500 mt-0.5">Elke rij wordt een apart artikel in het systeem</p>
          </div>
          <div className="p-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-200">
                    <Th>Artikelnr *</Th>
                    <Th>Type</Th>
                    <Th>Breedte cm</Th>
                    <Th>Lengte cm</Th>
                    <Th>Karpi-code</Th>
                    <Th>EAN</Th>
                    <Th>Verkoop €</Th>
                    <Th>Inkoop €</Th>
                    <Th>Gewicht kg</Th>
                    <Th>Voorraad</Th>
                    <Th>Locatie</Th>
                    <th className="pb-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={r._key} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                      <Td>
                        <input
                          value={r.artikelnr}
                          onChange={e => updateRow(r._key, 'artikelnr', e.target.value)}
                          className="input w-28 font-mono text-xs"
                          placeholder="298480000"
                        />
                      </Td>
                      <Td>
                        <select
                          value={r.product_type}
                          onChange={e => updateRow(r._key, 'product_type', e.target.value)}
                          className="input w-36"
                        >
                          <option value="">— type —</option>
                          {PRODUCT_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </Td>
                      <Td>
                        <input
                          type="number" min="0"
                          value={r.breedte}
                          onChange={e => updateRow(r._key, 'breedte', e.target.value)}
                          className="input w-20"
                          placeholder="160"
                        />
                      </Td>
                      <Td>
                        <input
                          type="number" min="0"
                          value={r.lengte}
                          onChange={e => updateRow(r._key, 'lengte', e.target.value)}
                          className="input w-20"
                          placeholder="230"
                        />
                      </Td>
                      <Td>
                        <input
                          value={r.karpi_code}
                          onChange={e => updateRow(r._key, 'karpi_code', e.target.value)}
                          className="input w-36 font-mono text-xs"
                          placeholder="FAMU48XX160230"
                        />
                      </Td>
                      <Td>
                        <input
                          value={r.ean_code}
                          onChange={e => updateRow(r._key, 'ean_code', e.target.value)}
                          className="input w-32 font-mono text-xs"
                          placeholder="8712345678901"
                        />
                      </Td>
                      <Td>
                        <input
                          type="number" step="0.01" min="0"
                          value={r.verkoopprijs}
                          onChange={e => updateRow(r._key, 'verkoopprijs', e.target.value)}
                          className="input w-24"
                        />
                      </Td>
                      <Td>
                        <input
                          type="number" step="0.01" min="0"
                          value={r.inkoopprijs}
                          onChange={e => updateRow(r._key, 'inkoopprijs', e.target.value)}
                          className="input w-24"
                        />
                      </Td>
                      <Td>
                        <input
                          type="number" step="0.01" min="0"
                          value={r.gewicht_kg}
                          onChange={e => updateRow(r._key, 'gewicht_kg', e.target.value)}
                          className="input w-20"
                        />
                      </Td>
                      <Td>
                        <input
                          type="number" min="0"
                          value={r.voorraad}
                          onChange={e => updateRow(r._key, 'voorraad', e.target.value)}
                          className="input w-20"
                        />
                      </Td>
                      <Td>
                        <input
                          value={r.locatie}
                          onChange={e => updateRow(r._key, 'locatie', e.target.value)}
                          className="input w-24"
                          placeholder="A3-12"
                        />
                      </Td>
                      <Td>
                        <button
                          type="button"
                          onClick={() => removeRow(r._key)}
                          disabled={rows.length === 1}
                          className="text-slate-300 hover:text-rose-500 disabled:opacity-20 transition-colors p-1"
                          title="Verwijder rij"
                        >
                          <Trash2 size={14} />
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={() => setRows(rs => [...rs, newRow()])}
              className="mt-4 flex items-center gap-1.5 text-sm text-terracotta-500 hover:text-terracotta-600 font-medium transition-colors"
            >
              <Plus size={15} /> Maat / variant toevoegen
            </button>
          </div>
        </section>

        {/* ── Sectie 3: Preview ──────────────────────────────────── */}
        {naam.trim() && filledRows.length > 0 && (
          <section className="bg-slate-50 rounded-[var(--radius)] border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Voorbeeld — zo komen de artikelen in het systeem
            </p>
            <table className="text-sm w-full">
              <thead>
                <tr className="text-xs text-slate-400">
                  <th className="text-left font-normal pb-1.5 pr-6">Artikelnr</th>
                  <th className="text-left font-normal pb-1.5 pr-6">Omschrijving</th>
                  <th className="text-left font-normal pb-1.5 pr-6">Type</th>
                  <th className="text-right font-normal pb-1.5">Verkoop</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filledRows.map(r => (
                  <tr key={r._key}>
                    <td className="py-1.5 pr-6 font-mono text-xs text-slate-500">{r.artikelnr}</td>
                    <td className="py-1.5 pr-6 text-slate-800">
                      {buildOmschrijving(naam, kleurCode, r.breedte, r.lengte)}
                    </td>
                    <td className="py-1.5 pr-6 text-slate-500">
                      {PRODUCT_TYPES.find(t => t.value === r.product_type)?.label ?? '—'}
                    </td>
                    <td className="py-1.5 text-right text-slate-700">
                      {r.verkoopprijs ? `€ ${Number(r.verkoopprijs).toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {error && (
          <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-[var(--radius-sm)] px-4 py-3">
            {error}
          </p>
        )}

        {/* ── Acties ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 pb-8">
          <button
            type="submit"
            disabled={isPending || filledRows.length === 0}
            className="px-6 py-2.5 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50 transition-colors"
          >
            {isPending
              ? 'Opslaan...'
              : `${filledRows.length} artikel${filledRows.length !== 1 ? 'en' : ''} aanmaken`}
          </button>
          <Link
            to="/producten"
            className="px-6 py-2.5 border border-slate-200 rounded-[var(--radius-sm)] text-sm text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Annuleren
          </Link>
        </div>

      </form>
    </>
  )
}

/* ── Hulpcomponenten ───────────────────────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1.5 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left text-xs font-medium text-slate-500 uppercase tracking-wide pb-2 pr-3 whitespace-nowrap">
      {children}
    </th>
  )
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="py-1.5 pr-3 align-top">{children}</td>
}
