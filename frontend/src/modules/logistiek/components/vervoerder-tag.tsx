import { getVervoerderDef, type VervoerderBadgeKleur } from '@/modules/logistiek/registry'

interface VervoerderTagProps {
  /** Gekozen vervoerdercode of `null`/`undefined` als selectie nog niet kan. */
  code: string | null | undefined
  /** Toon "—" met grijze badge als geen code, anders niets renderen. */
  showLeeg?: boolean
}

const KLEUR_STYLES: Record<VervoerderBadgeKleur, string> = {
  blauw:  'bg-blue-100 text-blue-700',
  oranje: 'bg-orange-100 text-orange-700',
  paars:  'bg-purple-100 text-purple-700',
  grijs:  'bg-slate-100 text-slate-500',
}

export function VervoerderTag({ code, showLeeg = false }: VervoerderTagProps) {
  const def = getVervoerderDef(code)

  if (!def) {
    if (!showLeeg) return null
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${KLEUR_STYLES.grijs}`}
        title="Geen vervoerder gekozen voor deze zending"
      >
        Geen
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${KLEUR_STYLES[def.badgeKleur]}`}
      title={`Vervoerder: ${def.displayNaam} (${def.type === 'api' ? 'API-koppeling' : 'EDI-koppeling'})`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {def.displayNaam}
    </span>
  )
}
