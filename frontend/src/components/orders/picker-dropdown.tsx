import { Link } from 'react-router-dom'
import { usePickers } from '@/hooks/use-pickers'

interface Props {
  value: number | null
  onChange: (id: number | null) => void
  disabled?: boolean
  placeholder?: string
  /** Visueel: leeg vs. compact (in een tabel-cel) */
  size?: 'normal' | 'compact'
}

export function PickerDropdown({
  value,
  onChange,
  disabled,
  placeholder = 'Kies picker…',
  size = 'normal',
}: Props) {
  const { data: pickers, isLoading } = usePickers()

  const baseClass =
    size === 'compact'
      ? 'px-2 py-1 text-sm rounded-[var(--radius-sm)] border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'
      : 'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

  if (isLoading) {
    return (
      <select disabled className={baseClass}>
        <option>Laden…</option>
      </select>
    )
  }

  if (!pickers || pickers.length === 0) {
    return (
      <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 px-3 py-2 rounded-[var(--radius-sm)]">
        Geen actieve pickers. Voeg er een toe in{' '}
        <Link
          to="/instellingen/medewerkers?tab=pickers"
          className="underline font-medium"
        >
          /instellingen/medewerkers
        </Link>
        .
      </div>
    )
  }

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      disabled={disabled}
      className={baseClass}
    >
      <option value="">{placeholder}</option>
      {pickers.map((p) => (
        <option key={p.id} value={p.id}>
          {p.naam}
        </option>
      ))}
    </select>
  )
}
