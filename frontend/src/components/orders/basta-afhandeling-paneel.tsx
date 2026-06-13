type Props = { alleenProductie: boolean; oudOrderNr: number | null; status: string }

/**
 * Informatiepaneel op order-detail voor productie-only orders (uit Basta).
 * Rendert NIETS voor gewone orders (gouden regel: strikt geguard op
 * alleen_productie). Maakt voor de werkvloer expliciet dat RugFlow alleen
 * snijden + confectie doet; verzenden en factureren gebeurt in Basta.
 */
export function BastaAfhandelingPaneel({ alleenProductie, oudOrderNr, status }: Props) {
  if (!alleenProductie) return null
  const afgerond = status === 'Maatwerk afgerond'
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <p className="font-medium text-amber-900">
        Productie-only order (Basta {oudOrderNr ?? '?'})
      </p>
      <p className="text-sm text-amber-800">
        {afgerond
          ? 'Maatwerk afgerond — labels printen, verzenden en factureren in Basta.'
          : 'Deze order doet in RugFlow alleen snijden + confectie. Verzenden en factureren gebeurt in Basta.'}
      </p>
    </div>
  )
}
