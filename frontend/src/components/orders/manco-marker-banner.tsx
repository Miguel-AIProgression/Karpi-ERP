import { Link } from 'react-router-dom'
import { PackageX } from 'lucide-react'

// Mig 518: permanente, historische markering dat deze order ooit een manco had
// (niet-gevonden colli tijdens het picken). Geen actie/wis-knop — puur een spoor.
// De binnendienst handelt de openstaande regel(s) af op de Manco-werklijst.
export function MancoMarkerBanner({ mancoSinds }: { mancoSinds: string }) {
  return (
    <div className="mb-4 rounded-[var(--radius)] border border-amber-300 bg-amber-50 p-4">
      <div className="mb-1 flex items-center gap-2 font-medium text-amber-900">
        <PackageX size={18} />
        Deze order had een mankement
      </div>
      <div className="text-sm text-amber-900">
        Er is tijdens het picken een colli niet gevonden (gemeld op{' '}
        {new Date(mancoSinds).toLocaleString('nl-NL')}). Open manco's worden afgehandeld op de{' '}
        <Link to="/orders?status=Manco" className="font-medium underline">
          Manco-werklijst
        </Link>
        .
      </div>
    </div>
  )
}
