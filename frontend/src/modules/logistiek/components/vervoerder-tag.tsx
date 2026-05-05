import { getVervoerderDef, type VervoerderBadgeKleur } from '@/modules/logistiek/registry'
import { useActieveVervoerder } from '../hooks/use-vervoerders'

interface VervoerderTagProps {
  /**
   * Expliciete vervoerdercode voor zending-specifieke weergave (logistiek-
   * pagina's met een vaste zending). Laat weg in pick-context: dan self-fetcht
   * de tag de actieve vervoerder via `useActieveVervoerder()` (slot-pattern,
   * ADR-0002).
   */
  code?: string | null
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
  const actief = useActieveVervoerder()
  const effectiveCode = code !== undefined ? code : actief.code
  const def = getVervoerderDef(effectiveCode)

  if (!def) {
    if (!showLeeg) return null
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${KLEUR_STYLES.grijs}`}
        title={tooltipVoorLeeg(code, actief.selectie_status)}
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

function tooltipVoorLeeg(
  code: string | null | undefined,
  status: ReturnType<typeof useActieveVervoerder>['selectie_status']
): string {
  // Expliciete code = NULL betekent: zending heeft geen vervoerder
  if (code !== undefined) return 'Geen vervoerder gekozen voor deze zending'
  // Geen code-prop → self-fetch context, status-tekst geeft betere uitleg
  if (status === 'meerdere_actieve_vervoerders') {
    return 'Meerdere vervoerders actief — richt eerst prijs/criteria-selectie in'
  }
  return 'Activeer eerst een vervoerder bij Logistiek › instellingen'
}
