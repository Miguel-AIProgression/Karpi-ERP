import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import {
  useVervoerder,
  useVervoerderStats,
  useRecenteZendingenVervoerder,
  useUpdateVervoerder,
} from '@/modules/logistiek/hooks/use-vervoerders'
import { useVervoerderForm } from '@/modules/logistiek/hooks/use-vervoerder-form'
import { VervoerderStatsCard } from '@/modules/logistiek/components/vervoerder-stats-card'
import { VervoerderRecenteZendingenTable } from '@/modules/logistiek/components/vervoerder-recente-zendingen-table'

export function VervoerderDetailPage() {
  const { code } = useParams<{ code: string }>()
  const { data: vervoerder, isLoading } = useVervoerder(code)
  const { data: alleStats = [] } = useVervoerderStats()
  const { data: recenteZendingen = [] } = useRecenteZendingenVervoerder(code, 10)
  const updateMut = useUpdateVervoerder()

  const stats = useMemo(
    () => alleStats.find((s) => s.code === code) ?? null,
    [alleStats, code],
  )

  const { form, update, reset, dirty, toUpdateInput } = useVervoerderForm(vervoerder)

  if (isLoading) return <div className="p-8 text-slate-500">Laden…</div>
  if (!vervoerder || !code)
    return <div className="p-8 text-rose-600">Vervoerder niet gevonden.</div>

  const isApi = vervoerder.type === 'api'

  function handleSave() {
    if (!code) return
    updateMut.mutate({ code, data: toUpdateInput(isApi) })
  }

  return (
    <>
      <div className="mb-4">
        <Link
          to="/logistiek/vervoerders"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} /> Terug naar vervoerders
        </Link>
      </div>

      {/* Header */}
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {vervoerder.display_naam}
            <TypeBadge type={vervoerder.type} />
          </span>
        }
        description={
          <span className="font-mono text-xs text-slate-500">{vervoerder.code}</span>
        }
        actions={
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">
              {vervoerder.actief ? 'Actief' : 'Inactief'}
            </span>
            <Toggle
              checked={vervoerder.actief}
              disabled={updateMut.isPending}
              onChange={(next) =>
                updateMut.mutate({ code, data: { actief: next } })
              }
            />
          </div>
        }
      />

      {/* Sectie 1 — Instellingen */}
      <Section titel="Instellingen">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isApi && (
            <>
              <Field label="API-endpoint">
                <input
                  type="text"
                  value={form.api_endpoint}
                  onChange={(e) => update('api_endpoint', e.target.value)}
                  placeholder="https://api.vervoerder.nl/v1"
                  className={inputClass}
                />
              </Field>
              <Field label="API-customer-id">
                <input
                  type="text"
                  value={form.api_customer_id}
                  onChange={(e) => update('api_customer_id', e.target.value)}
                  placeholder="KARPI-12345"
                  className={inputClass}
                />
              </Field>
            </>
          )}
          <Field label="Account-nummer">
            <input
              type="text"
              value={form.account_nummer}
              onChange={(e) => update('account_nummer', e.target.value)}
              placeholder="Klant- of contractnummer bij vervoerder"
              className={inputClass}
            />
          </Field>
        </div>
        {!isApi && (
          <div className="mt-2 text-xs text-slate-400 italic">
            Geen API-instellingen — deze vervoerder ontvangt zendingen via EDI.
          </div>
        )}
      </Section>

      {/* Sectie 2 — Contact */}
      <Section titel="Contact">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Naam">
            <input
              type="text"
              value={form.kontakt_naam}
              onChange={(e) => update('kontakt_naam', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="E-mail">
            <input
              type="email"
              value={form.kontakt_email}
              onChange={(e) => update('kontakt_email', e.target.value)}
              className={inputClass}
            />
            {form.kontakt_email && (
              <a
                href={`mailto:${form.kontakt_email}`}
                className="text-xs text-terracotta-600 hover:underline mt-1 inline-block"
              >
                {form.kontakt_email}
              </a>
            )}
          </Field>
          <Field label="Telefoon">
            <input
              type="tel"
              value={form.kontakt_telefoon}
              onChange={(e) => update('kontakt_telefoon', e.target.value)}
              className={inputClass}
            />
            {form.kontakt_telefoon && (
              <a
                href={`tel:${form.kontakt_telefoon}`}
                className="text-xs text-terracotta-600 hover:underline mt-1 inline-block"
              >
                {form.kontakt_telefoon}
              </a>
            )}
          </Field>
        </div>
      </Section>

      {/* Sectie 3 — Tarieven */}
      <Section titel="Tarieven">
        <textarea
          value={form.tarief_notities}
          onChange={(e) => update('tarief_notities', e.target.value)}
          placeholder="Bv. NL postcodes 1000-9999: € 12,50; BE: € 18,00; gewicht > 30 kg: + € 5,00"
          className={`${inputClass} min-h-[120px] font-mono text-xs`}
        />
        <div className="mt-2 text-xs text-slate-400 italic">
          Vrije tekst voor V1 — gestructureerde tariefmatrix volgt in Fase B.
        </div>
      </Section>

      {/* Sectie 4 — Algemene notities */}
      <Section titel="Algemene notities">
        <textarea
          value={form.notities}
          onChange={(e) => update('notities', e.target.value)}
          placeholder="Vrije aantekeningen over deze vervoerder."
          className={`${inputClass} min-h-[80px]`}
        />
      </Section>

      {/* Form-actions */}
      <div className="flex items-center justify-end gap-2 mb-8">
        <button
          type="button"
          onClick={reset}
          disabled={!dirty || updateMut.isPending}
          className="px-4 py-2 rounded-[var(--radius-sm)] text-sm font-medium border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-50"
        >
          Annuleren
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || updateMut.isPending}
          className="px-4 py-2 rounded-[var(--radius-sm)] text-sm font-medium bg-terracotta-600 text-white hover:bg-terracotta-700 disabled:opacity-50"
        >
          {updateMut.isPending ? 'Opslaan…' : 'Opslaan'}
        </button>
      </div>

      {updateMut.isError && (
        <div className="mb-6 text-xs text-rose-600">
          Opslaan mislukt: {String((updateMut.error as Error).message)}
        </div>
      )}

      {/* Sectie 5 — Statistieken */}
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Statistieken</h3>
      <div className="mb-6">
        <VervoerderStatsCard stats={stats} />
      </div>

      {/* Sectie 6 — Recente zendingen */}
      <Section titel={`Recente zendingen (${recenteZendingen.length})`}>
        <VervoerderRecenteZendingenTable zendingen={recenteZendingen} />
      </Section>
    </>
  )
}

const inputClass =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400 disabled:opacity-50'

function Section({
  titel,
  children,
}: {
  titel: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5 mb-6">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">{titel}</h3>
      {children}
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      {children}
    </div>
  )
}

function TypeBadge({ type }: { type: 'api' | 'edi' }) {
  const styles =
    type === 'api'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-orange-100 text-orange-700'
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${styles}`}
    >
      {type}
    </span>
  )
}

interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}

function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 disabled:opacity-50 ${
        checked ? 'bg-terracotta-500' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
