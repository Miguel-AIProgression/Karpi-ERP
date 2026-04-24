import { useState, useEffect } from 'react'
import { Building2, Save, CheckCircle2, AlertCircle } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/page-header'
import { fetchBedrijfsConfig, updateBedrijfsConfig } from '@/lib/supabase/queries/bedrijfsconfig'
import type { BedrijfsConfig } from '@/lib/supabase/queries/bedrijfsconfig'

const EMPTY: BedrijfsConfig = {
  bedrijfsnaam: '', adres: '', postcode: '', plaats: '', land: '',
  telefoon: '', fax: '', email: '', website: '',
  kvk: '', btw_nummer: '',
  bank: '', rekeningnummer: '', iban: '', bic: '',
  betalingscondities_tekst: '',
}

const inputCls =
  'w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  )
}

function Section({ icon, title, children }: { icon?: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

export function BedrijfsgegevensPage() {
  const queryClient = useQueryClient()
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['bedrijfsgegevens'],
    queryFn: fetchBedrijfsConfig,
    retry: false,
  })

  const [form, setForm] = useState<BedrijfsConfig>(EMPTY)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (data) setForm(data)
  }, [data])

  const dirty = !!data && JSON.stringify(form) !== JSON.stringify(data)

  const mutation = useMutation({
    mutationFn: () => updateBedrijfsConfig(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bedrijfsgegevens'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  function set(key: keyof BedrijfsConfig, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  if (isLoading) {
    return (
      <>
        <PageHeader title="Bedrijfsgegevens" />
        <div className="text-slate-400">Laden...</div>
      </>
    )
  }

  if (isError) {
    const msg = (error as Error)?.message ?? ''
    const notFound = msg.includes('PGRST116') || msg.toLowerCase().includes('not found') || msg.includes('0 rows')
    return (
      <>
        <PageHeader title="Bedrijfsgegevens" />
        <div className="flex items-start gap-3 p-4 rounded-[var(--radius-sm)] bg-amber-50 border border-amber-200 text-amber-800 text-sm max-w-xl">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            {notFound
              ? 'Bedrijfsgegevens nog niet geïnitialiseerd — run migratie 120.'
              : `Fout bij laden: ${msg}`}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Bedrijfsgegevens"
        description="Bedrijfsinformatie die verschijnt op facturen en documenten"
        actions={
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !dirty}
            className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 transition-colors disabled:opacity-50"
          >
            {saved ? <CheckCircle2 size={16} /> : <Save size={16} />}
            {mutation.isPending ? 'Opslaan...' : saved ? 'Opgeslagen!' : 'Opslaan'}
          </button>
        }
      />

      {mutation.isError && (
        <div className="mb-4 p-3 rounded-[var(--radius-sm)] bg-red-50 text-red-700 text-sm">
          Fout bij opslaan: {(mutation.error as Error).message}
        </div>
      )}

      {saved && (
        <div className="mb-4 p-3 rounded-[var(--radius-sm)] bg-emerald-50 text-emerald-700 text-sm flex items-center gap-2">
          <CheckCircle2 size={16} />
          Bedrijfsgegevens succesvol opgeslagen.
        </div>
      )}

      <div className="space-y-6 max-w-2xl">
        <Section icon={<Building2 size={18} className="text-slate-500" />} title="Bedrijf">
          <Field label="Bedrijfsnaam">
            <input className={inputCls} value={form.bedrijfsnaam} onChange={(e) => set('bedrijfsnaam', e.target.value)} />
          </Field>
          <Field label="Adres">
            <input className={inputCls} value={form.adres} onChange={(e) => set('adres', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Postcode">
              <input className={inputCls} value={form.postcode} onChange={(e) => set('postcode', e.target.value)} />
            </Field>
            <Field label="Plaats">
              <input className={inputCls} value={form.plaats} onChange={(e) => set('plaats', e.target.value)} />
            </Field>
          </div>
          <Field label="Land">
            <input className={inputCls} value={form.land} onChange={(e) => set('land', e.target.value)} />
          </Field>
        </Section>

        <Section title="Contact">
          <Field label="Telefoon">
            <input className={inputCls} type="tel" value={form.telefoon} onChange={(e) => set('telefoon', e.target.value)} />
          </Field>
          <Field label="Fax (optioneel)">
            <input className={inputCls} type="tel" value={form.fax ?? ''} onChange={(e) => set('fax', e.target.value)} />
          </Field>
          <Field label="E-mailadres">
            <input className={inputCls} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Website">
            <input className={inputCls} type="url" value={form.website} onChange={(e) => set('website', e.target.value)} />
          </Field>
        </Section>

        <Section title="Registratie & Fiscaal">
          <Field label="KvK-nummer">
            <input className={inputCls} value={form.kvk} onChange={(e) => set('kvk', e.target.value)} />
          </Field>
          <Field label="BTW-nummer">
            <input className={inputCls} value={form.btw_nummer} onChange={(e) => set('btw_nummer', e.target.value)} />
          </Field>
        </Section>

        <Section title="Bank">
          <Field label="Bank">
            <input className={inputCls} value={form.bank} onChange={(e) => set('bank', e.target.value)} />
          </Field>
          <Field label="Rekeningnummer">
            <input className={inputCls} value={form.rekeningnummer} onChange={(e) => set('rekeningnummer', e.target.value)} />
          </Field>
          <Field label="IBAN">
            <input className={inputCls} value={form.iban} onChange={(e) => set('iban', e.target.value)} />
          </Field>
          <Field label="BIC">
            <input className={inputCls} value={form.bic} onChange={(e) => set('bic', e.target.value)} />
          </Field>
        </Section>

        <Section title="Facturering">
          <Field label="Betalingscondities tekst">
            <textarea
              rows={4}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400 resize-y"
              value={form.betalingscondities_tekst}
              onChange={(e) => set('betalingscondities_tekst', e.target.value)}
            />
          </Field>
        </Section>
      </div>
    </>
  )
}
