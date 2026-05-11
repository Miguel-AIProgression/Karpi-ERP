import { useKlantBenaming } from '../hooks/use-klant-benaming'

interface KlantBenamingProps {
  debiteurNr: number | null | undefined
  kwaliteit: string | null | undefined
  kleur?: string | null
  fallback: string
  className?: string
}

/**
 * Slot-component voor klant-bound benaming-resolutie. Self-fetcht via
 * `resolve_klanteigen_naam`-RPC met 5-niveaus fallback (klant+kleur >
 * klant+NULL > inkoopgroep+kleur > inkoopgroep+NULL > NULL).
 *
 * Gebruik vanuit elke Module die voor een (debiteur, kwaliteit, kleur)
 * de klant-eigen naam wil tonen — geen hook-imports of resolver-shape
 * doorgeven. Geen TS-spiegel van de fallback-logica; SQL is bron-van-waarheid.
 *
 * Backend-callers (factuur-RPC, EDI-builder, pakbon-edge) consumeren
 * `resolve_klanteigen_naam` direct.
 */
export function KlantBenaming({
  debiteurNr,
  kwaliteit,
  kleur,
  fallback,
  className,
}: KlantBenamingProps) {
  const { data: benaming } = useKlantBenaming({
    debiteurNr,
    kwaliteitCode: kwaliteit,
    kleurCode: kleur ?? null,
  })
  return <span className={className}>{benaming ?? fallback}</span>
}
