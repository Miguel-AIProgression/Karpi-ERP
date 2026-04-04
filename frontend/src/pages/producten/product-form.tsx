import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useKwaliteiten, useLeveranciers, useUpdateProduct } from '@/hooks/use-producten'
import type { ProductDetail, ProductFormData, ProductType } from '@/lib/supabase/queries/producten'

const PRODUCT_TYPES: { value: ProductType; label: string }[] = [
  { value: 'vast', label: 'Standaard maat' },
  { value: 'rol', label: 'Rol' },
  { value: 'staaltje', label: 'Staal' },
  { value: 'overig', label: 'Overig' },
]

interface ProductFormProps {
  product?: ProductDetail
}

export function ProductFormPage({ product }: ProductFormProps) {
  const navigate = useNavigate()
  const { data: kwaliteiten } = useKwaliteiten()
  const { data: leveranciers } = useLeveranciers()
  const updateMutation = useUpdateProduct()

  const [form, setForm] = useState<ProductFormData>({
    artikelnr: product?.artikelnr ?? '',
    karpi_code: product?.karpi_code ?? '',
    ean_code: product?.ean_code ?? '',
    omschrijving: product?.omschrijving ?? '',
    vervolgomschrijving: product?.vervolgomschrijving ?? '',
    kwaliteit_code: product?.kwaliteit_code ?? '',
    kleur_code: product?.kleur_code ?? '',
    product_type: product?.product_type ?? null,
    verkoopprijs: product?.verkoopprijs ?? undefined,
    inkoopprijs: product?.inkoopprijs ?? undefined,
    gewicht_kg: product?.gewicht_kg ?? undefined,
    voorraad: product?.voorraad ?? 0,
    besteld_inkoop: product?.besteld_inkoop ?? 0,
    locatie: product?.locatie ?? '',
    leverancier_id: (product as ProductDetail & { leverancier_id?: number | null })?.leverancier_id ?? null,
    actief: product?.actief ?? true,
  })
  const [error, setError] = useState<string | null>(null)

  const set = (field: keyof ProductFormData, value: unknown) =>
    setForm(f => ({ ...f, [field]: value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const { artikelnr, ...rest } = form
      void artikelnr
      await updateMutation.mutateAsync({ artikelnr: product!.artikelnr, data: rest })
      navigate(`/producten/${product!.artikelnr}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Er is een fout opgetreden')
    }
  }

  const isPending = updateMutation.isPending

  return (
    <>
      <div className="mb-4">
        <Link
          to={`/producten/${product!.artikelnr}`}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} /> Terug naar product
        </Link>
      </div>

      <PageHeader
        title={`${product!.omschrijving} bewerken`}
        description={`Artikelnr: ${product!.artikelnr}`}
      />

      <form onSubmit={handleSubmit} className="max-w-3xl space-y-6 mt-6">

        {/* Identificatie */}
        <section className="bg-white rounded-[var(--radius)] border border-slate-200 p-6">
          <h3 className="font-medium mb-4">Identificatie</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Artikelnr *">
              <input
                required
                disabled
                value={form.artikelnr}
                onChange={e => set('artikelnr', e.target.value)}
                className="input"
                placeholder="bijv. 526160001"
              />
            </Field>
            <Field label="Karpi-code">
              <input
                value={form.karpi_code ?? ''}
                onChange={e => set('karpi_code', e.target.value || null)}
                className="input"
                placeholder="bijv. PABL16XX155230"
              />
            </Field>
            <Field label="EAN-code">
              <input
                value={form.ean_code ?? ''}
                onChange={e => set('ean_code', e.target.value || null)}
                className="input"
              />
            </Field>
            <Field label="Type">
              <select
                value={form.product_type ?? ''}
                onChange={e => set('product_type', e.target.value as ProductType || null)}
                className="input"
              >
                <option value="">— selecteer —</option>
                {PRODUCT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        {/* Omschrijving */}
        <section className="bg-white rounded-[var(--radius)] border border-slate-200 p-6">
          <h3 className="font-medium mb-4">Omschrijving</h3>
          <div className="space-y-4">
            <Field label="Omschrijving *">
              <input
                required
                value={form.omschrijving}
                onChange={e => set('omschrijving', e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Vervolgomschrijving">
              <input
                value={form.vervolgomschrijving ?? ''}
                onChange={e => set('vervolgomschrijving', e.target.value || null)}
                className="input"
              />
            </Field>
          </div>
        </section>

        {/* Classificatie */}
        <section className="bg-white rounded-[var(--radius)] border border-slate-200 p-6">
          <h3 className="font-medium mb-4">Classificatie</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Kwaliteit">
              <select
                value={form.kwaliteit_code ?? ''}
                onChange={e => set('kwaliteit_code', e.target.value || null)}
                className="input"
              >
                <option value="">— geen —</option>
                {kwaliteiten?.map(k => (
                  <option key={k.code} value={k.code}>{k.code}{k.omschrijving ? ` – ${k.omschrijving}` : ''}</option>
                ))}
              </select>
            </Field>
            <Field label="Kleurcode">
              <input
                value={form.kleur_code ?? ''}
                onChange={e => set('kleur_code', e.target.value || null)}
                className="input"
                placeholder="bijv. 16"
              />
            </Field>
            <Field label="Leverancier">
              <select
                value={form.leverancier_id ?? ''}
                onChange={e => set('leverancier_id', e.target.value ? Number(e.target.value) : null)}
                className="input"
              >
                <option value="">— geen —</option>
                {leveranciers?.map(l => (
                  <option key={l.id} value={l.id}>{l.naam}</option>
                ))}
              </select>
            </Field>
            <Field label="Locatie">
              <input
                value={form.locatie ?? ''}
                onChange={e => set('locatie', e.target.value || null)}
                className="input"
                placeholder="bijv. A3-12"
              />
            </Field>
          </div>
        </section>

        {/* Prijzen & gewicht */}
        <section className="bg-white rounded-[var(--radius)] border border-slate-200 p-6">
          <h3 className="font-medium mb-4">Prijzen & gewicht</h3>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Verkoopprijs (€)">
              <input
                type="number" step="0.01" min="0"
                value={form.verkoopprijs ?? ''}
                onChange={e => set('verkoopprijs', e.target.value ? Number(e.target.value) : null)}
                className="input"
              />
            </Field>
            <Field label="Inkoopprijs (€)">
              <input
                type="number" step="0.01" min="0"
                value={form.inkoopprijs ?? ''}
                onChange={e => set('inkoopprijs', e.target.value ? Number(e.target.value) : null)}
                className="input"
              />
            </Field>
            <Field label="Gewicht (kg)">
              <input
                type="number" step="0.01" min="0"
                value={form.gewicht_kg ?? ''}
                onChange={e => set('gewicht_kg', e.target.value ? Number(e.target.value) : null)}
                className="input"
              />
            </Field>
          </div>
        </section>

        {/* Voorraad */}
        <section className="bg-white rounded-[var(--radius)] border border-slate-200 p-6">
          <h3 className="font-medium mb-4">Voorraad</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Voorraad">
              <input
                type="number" min="0"
                value={form.voorraad ?? 0}
                onChange={e => set('voorraad', Number(e.target.value))}
                className="input"
              />
            </Field>
            <Field label="Besteld (inkoop)">
              <input
                type="number" min="0"
                value={form.besteld_inkoop ?? 0}
                onChange={e => set('besteld_inkoop', Number(e.target.value))}
                className="input"
              />
            </Field>
          </div>
        </section>

        {/* Status */}
        <section className="bg-white rounded-[var(--radius)] border border-slate-200 p-6">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.actief ?? true}
              onChange={e => set('actief', e.target.checked)}
              className="w-4 h-4"
            />
            <span className="font-medium">Actief</span>
          </label>
        </section>

        {error && (
          <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-[var(--radius-sm)] px-4 py-3">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="px-6 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50"
          >
            {isPending ? 'Opslaan...' : 'Wijzigingen opslaan'}
          </button>
          <Link
            to={`/producten/${product!.artikelnr}`}
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
