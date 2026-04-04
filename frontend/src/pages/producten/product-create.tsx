import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useKwaliteiten, useCreateProduct } from '@/hooks/use-producten'
import type { ProductType } from '@/lib/supabase/queries/producten'

const PRODUCT_TYPES: { value: ProductType; label: string }[] = [
  { value: 'vast', label: 'Standaard maat' },
  { value: 'rol', label: 'Rol' },
  { value: 'staaltje', label: 'Staal' },
  { value: 'overig', label: 'Overig' },
]

interface VariantRow {
  id: string
  artikelnr: string
  breedte: string
  lengte: string
  karpi_code: string
  verkoopprijs: string
  inkoopprijs: string
  voorraad: string
  locatie: string
}

let _counter = 0
function makeVariant(): VariantRow {
  return {
    id: String(++_counter),
    artikelnr: '',
    breedte: '',
    lengte: '',
    karpi_code: '',
    verkoopprijs: '',
    inkoopprijs: '',
    voorraad: '0',
    locatie: '',
  }
}

function buildOmschrijving(naam: string, kleurCode: string, breedte: string, lengte: string) {
  const parts: string[] = [naam]
  if (kleurCode) parts.push(`Kleur ${kleurCode}`)
  if (breedte && lengte) parts.push(`${breedte}x${lengte}cm`)
  return parts.join(' ')
}

export function ProductCreatePage() {
  const navigate = useNavigate()
  const { data: kwaliteiten } = useKwaliteiten()
  const createMutation = useCreateProduct()

  const [naam, setNaam] = useState('')
  const [kwaliteitCode, setKwaliteitCode] = useState('')
  const [kleurCode, setKleurCode] = useState('')
  const [productType, setProductType] = useState<ProductType | null>(null)
  const [actief, setActief] = useState(true)
  const [variants, setVariants] = useState<VariantRow[]>([makeVariant()])
  const [error, setError] = useState<string | null>(null)

  function setField(id: string, field: keyof VariantRow, value: string) {
    setVariants(vs => vs.map(v => v.id === id ? { ...v, [field]: value } : v))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const toCreate = variants.filter(v => v.artikelnr.trim())
    if (toCreate.length === 0) {
      setError('Voeg minimaal één variant toe met een artikelnr.')
      return
    }

    try {
      for (const v of toCreate) {
        await createMutation.mutateAsync({
          artikelnr: v.artikelnr.trim(),
          karpi_code: v.karpi_code.trim() || null,
          omschrijving: buildOmschrijving(naam, kleurCode, v.breedte, v.lengte),
          kwaliteit_code: kwaliteitCode || null,
          kleur_code: kleurCode || null,
          product_type: productType,
          verkoopprijs: v.verkoopprijs ? Number(v.verkoopprijs) : null,
          inkoopprijs: v.inkoopprijs ? Number(v.inkoopprijs) : null,
          voorraad: v.voorraad ? Number(v.voorraad) : 0,
          locatie: v.locatie.trim() || null,
          actief,
        })
      }
      navigate(`/producten/${toCreate[0].artikelnr.trim()}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Er is een fout opgetreden')
    }
  }

  const filledVariants = variants.filter(v => v.artikelnr.trim())
  const isPending = createMutation.isPending

  return (
    <>
      <div className="mb-4">
        <Link to="/producten" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft size={14} /> Terug naar producten
        </Link>
      </div>

      <PageHeader title="Nieuw product" />

      <form onSubmit={handleSubmit} className="mt-6 space-y-6 max-w-5xl">

        {/* Familie */}
        <section className="bg-white rounded-[var(--radius)] border border-slate-200 p-6">
          <h3 className="font-medium mb-4">Familie</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Naam *">
              <input
                required
                value={naam}
                onChange={e => setNaam(e.target.value)}
                className="input"
                placeholder="bijv. FADED MUSCAT"
              />
            </Field>
            <Field label="Type">
              <select
                value={productType ?? ''}
                onChange={e => setProductType(e.target.value as ProductType || null)}
                className="input"
              >
                <option value="">— selecteer —</option>
                {PRODUCT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Kwaliteit">
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
          </div>
          <div className="mt-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={actief}
                onChange={e => setActief(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium">Actief</span>
            </label>
          </div>
        </section>

        {/* Maten / Varianten */}
        <section className="bg-white rounded-[var(--radius)] border border-slate-200 p-6">
          <h3 className="font-medium mb-4">Maten / Varianten</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-slate-500 font-normal pb-2 pr-3 whitespace-nowrap">Artikelnr *</th>
                  <th className="text-left text-slate-500 font-normal pb-2 pr-3 whitespace-nowrap">Breedte (cm)</th>
                  <th className="text-left text-slate-500 font-normal pb-2 pr-3 whitespace-nowrap">Lengte (cm)</th>
                  <th className="text-left text-slate-500 font-normal pb-2 pr-3 whitespace-nowrap">Karpi-code</th>
                  <th className="text-left text-slate-500 font-normal pb-2 pr-3 whitespace-nowrap">Verkoop (€)</th>
                  <th className="text-left text-slate-500 font-normal pb-2 pr-3 whitespace-nowrap">Inkoop (€)</th>
                  <th className="text-left text-slate-500 font-normal pb-2 pr-3 whitespace-nowrap">Voorraad</th>
                  <th className="text-left text-slate-500 font-normal pb-2 pr-3 whitespace-nowrap">Locatie</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {variants.map(v => (
                  <tr key={v.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 pr-3">
                      <input
                        value={v.artikelnr}
                        onChange={e => setField(v.id, 'artikelnr', e.target.value)}
                        className="input w-28"
                        placeholder="298480000"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number" min="0"
                        value={v.breedte}
                        onChange={e => setField(v.id, 'breedte', e.target.value)}
                        className="input w-20"
                        placeholder="160"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number" min="0"
                        value={v.lengte}
                        onChange={e => setField(v.id, 'lengte', e.target.value)}
                        className="input w-20"
                        placeholder="230"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        value={v.karpi_code}
                        onChange={e => setField(v.id, 'karpi_code', e.target.value)}
                        className="input w-36"
                        placeholder="FAMU48XX160230"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number" step="0.01" min="0"
                        value={v.verkoopprijs}
                        onChange={e => setField(v.id, 'verkoopprijs', e.target.value)}
                        className="input w-24"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number" step="0.01" min="0"
                        value={v.inkoopprijs}
                        onChange={e => setField(v.id, 'inkoopprijs', e.target.value)}
                        className="input w-24"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number" min="0"
                        value={v.voorraad}
                        onChange={e => setField(v.id, 'voorraad', e.target.value)}
                        className="input w-20"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        value={v.locatie}
                        onChange={e => setField(v.id, 'locatie', e.target.value)}
                        className="input w-24"
                        placeholder="A3-12"
                      />
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => setVariants(vs => vs.filter(x => x.id !== v.id))}
                        disabled={variants.length === 1}
                        className="text-slate-300 hover:text-rose-500 disabled:opacity-30 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={() => setVariants(vs => [...vs, makeVariant()])}
            className="mt-4 flex items-center gap-1.5 text-sm text-terracotta-500 hover:text-terracotta-600 font-medium"
          >
            <Plus size={15} /> Maat toevoegen
          </button>
        </section>

        {/* Preview */}
        {naam && filledVariants.length > 0 && (
          <section className="bg-slate-50 rounded-[var(--radius)] border border-slate-200 p-4">
            <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wide">Voorbeeld omschrijvingen</p>
            <div className="space-y-1">
              {filledVariants.map(v => (
                <p key={v.id} className="text-sm text-slate-700">
                  <span className="font-mono text-slate-400 mr-3 text-xs">{v.artikelnr}</span>
                  {buildOmschrijving(naam, kleurCode, v.breedte, v.lengte)}
                </p>
              ))}
            </div>
          </section>
        )}

        {error && (
          <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-[var(--radius-sm)] px-4 py-3">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isPending || filledVariants.length === 0}
            className="px-6 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50"
          >
            {isPending
              ? 'Opslaan...'
              : `${filledVariants.length} product${filledVariants.length !== 1 ? 'en' : ''} aanmaken`}
          </button>
          <Link
            to="/producten"
            className="px-6 py-2 border border-slate-200 rounded-[var(--radius-sm)] text-sm text-slate-600 hover:bg-slate-50"
          >
            Annuleren
          </Link>
        </div>

      </form>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  )
}
