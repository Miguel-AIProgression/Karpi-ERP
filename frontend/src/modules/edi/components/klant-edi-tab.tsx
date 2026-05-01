import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchHandelspartnerConfig,
  upsertHandelspartnerConfig,
  type EdiHandelspartnerConfig,
} from '@/modules/edi/queries/edi'
import {
  getBerichttypenVoorRichting,
  type BerichttypeDef,
  type ConfigToggleKey,
} from '@/modules/edi/registry'

interface KlantEdiTabProps {
  debiteurNr: number
}

const EMPTY_CONFIG: EdiHandelspartnerConfig = {
  debiteur_nr: 0,
  transus_actief: false,
  order_in: false,
  orderbev_uit: false,
  factuur_uit: false,
  verzend_uit: false,
  test_modus: false,
  notities: null,
  created_at: '',
  updated_at: '',
}

const INKOMEND = getBerichttypenVoorRichting('in')
const UITGAAND = getBerichttypenVoorRichting('uit')

export function KlantEdiTab({ debiteurNr }: KlantEdiTabProps) {
  const queryClient = useQueryClient()
  const { data: config, isLoading } = useQuery({
    queryKey: ['edi-handelspartner-config', debiteurNr],
    queryFn: () => fetchHandelspartnerConfig(debiteurNr),
    enabled: debiteurNr > 0,
  })

  const current = useMemo<EdiHandelspartnerConfig>(
    () => config ?? { ...EMPTY_CONFIG, debiteur_nr: debiteurNr },
    [config, debiteurNr],
  )

  const mutation = useMutation({
    mutationFn: (next: EdiHandelspartnerConfig) =>
      upsertHandelspartnerConfig({
        debiteur_nr: next.debiteur_nr,
        transus_actief: next.transus_actief,
        order_in: next.order_in,
        orderbev_uit: next.orderbev_uit,
        factuur_uit: next.factuur_uit,
        verzend_uit: next.verzend_uit,
        test_modus: next.test_modus,
        notities: next.notities,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['edi-handelspartner-config', debiteurNr] })
      queryClient.invalidateQueries({ queryKey: ['klanten', debiteurNr] })
      queryClient.invalidateQueries({ queryKey: ['klanten'] })
    },
  })

  const [notitiesDraft, setNotitiesDraft] = useState<string | null>(null)
  const notitiesValue = notitiesDraft ?? current.notities ?? ''

  function update<K extends keyof EdiHandelspartnerConfig>(key: K, value: EdiHandelspartnerConfig[K]) {
    mutation.mutate({ ...current, [key]: value })
  }

  function commitNotities() {
    if (notitiesDraft === null) return
    const trimmed = notitiesDraft.trim()
    const next = trimmed === '' ? null : trimmed
    if (next === current.notities) {
      setNotitiesDraft(null)
      return
    }
    update('notities', next)
    setNotitiesDraft(null)
  }

  if (debiteurNr <= 0) {
    return <div className="p-5 text-sm text-slate-400">Geen klant geselecteerd</div>
  }

  if (isLoading) {
    return <div className="p-5 text-sm text-slate-400">EDI-configuratie laden…</div>
  }

  const processenDisabled = !current.transus_actief

  return (
    <div className="p-5 space-y-6 text-sm">
      <div className="flex items-start justify-between border-b border-slate-100 pb-4">
        <div>
          <div className="font-medium text-slate-900">EDI via Transus</div>
          <div className="text-xs text-slate-500 mt-0.5">
            Hoofdschakelaar — als uit, wordt deze klant door de EDI-laag genegeerd (handmatige flow).
          </div>
        </div>
        <Toggle
          checked={current.transus_actief}
          onChange={(v) => update('transus_actief', v)}
          disabled={mutation.isPending}
        />
      </div>

      <div className="flex items-start justify-between">
        <div>
          <div className="font-medium text-slate-900">Test-modus</div>
          <div className="text-xs text-slate-500 mt-0.5">
            Markeer alle uitgaande berichten als <code className="text-[11px]">IsTestMessage=Y</code>.
            Voor cutover-test-handelspartner of staging.
          </div>
        </div>
        <Toggle
          checked={current.test_modus}
          onChange={(v) => update('test_modus', v)}
          disabled={mutation.isPending}
        />
      </div>

      <ProcessenSection
        titel="Inkomend"
        items={INKOMEND}
        config={current}
        disabled={processenDisabled}
        onToggle={(toggleKey, value) => update(toggleKey, value)}
        mutationPending={mutation.isPending}
      />

      <ProcessenSection
        titel="Uitgaand"
        items={UITGAAND}
        config={current}
        disabled={processenDisabled}
        onToggle={(toggleKey, value) => update(toggleKey, value)}
        mutationPending={mutation.isPending}
      />

      {processenDisabled && (
        <div className="text-xs text-slate-400 italic">
          Activeer eerst de hoofdschakelaar om processen te kunnen aanzetten.
        </div>
      )}

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 block mb-2">
          Notities
        </label>
        <textarea
          value={notitiesValue}
          onChange={(e) => setNotitiesDraft(e.target.value)}
          onBlur={commitNotities}
          disabled={mutation.isPending}
          placeholder="Partner-specifieke aantekeningen — bv. 'Karpi-artnr in BP-veld', schema-versie, contactpersoon Transus"
          className="w-full min-h-[80px] px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400 disabled:opacity-50"
        />
      </div>

      {mutation.isError && (
        <div className="text-xs text-red-600">
          Opslaan mislukt: {String((mutation.error as Error).message)}
        </div>
      )}
    </div>
  )
}

interface ProcessenSectionProps {
  titel: string
  items: BerichttypeDef[]
  config: EdiHandelspartnerConfig
  disabled: boolean
  onToggle: (toggleKey: ConfigToggleKey, value: boolean) => void
  mutationPending: boolean
}

function ProcessenSection({ titel, items, config, disabled, onToggle, mutationPending }: ProcessenSectionProps) {
  if (items.length === 0) return null
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
        {titel}
      </div>
      <div className={`rounded-[var(--radius-sm)] border border-slate-200 divide-y divide-slate-100 ${disabled ? 'opacity-50' : ''}`}>
        {items.map((def) => (
          <div key={def.code} className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="font-medium text-slate-800">{def.uiLabel}</div>
              <div className="text-xs text-slate-500 mt-0.5">{def.uiSubtitle}</div>
            </div>
            <Toggle
              checked={Boolean(config[def.configToggleKey])}
              onChange={(v) => onToggle(def.configToggleKey, v)}
              disabled={mutationPending || disabled}
            />
          </div>
        ))}
      </div>
    </div>
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
