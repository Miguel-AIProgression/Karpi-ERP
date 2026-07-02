// A4-picklijst: één loopblad met alle zendingen van de zojuist-gestarte
// pickronde-groep, zodat de picker ermee door het magazijn loopt en
// bijzonderheden kan noteren. Opmaak spiegelt de pakbon (KARPI-header,
// monospace, dashed dividers) zodat het één documentfamilie is.
import { useQuery } from '@tanstack/react-query'
import { formatNumber } from '@/lib/utils/formatters'
import { fetchBedrijfsConfig } from '@/lib/supabase/queries/bedrijfsconfig'
import { bouwPicklijst } from '@/modules/logistiek/lib/printset'
import type { ZendingPrintSet } from '@/modules/logistiek/queries/zendingen'

function DashedDivider() {
  return <div className="border-t border-dashed border-slate-700" />
}

// Kolomindeling — header, regels en totaalregel delen dit grid.
const RIJ_GRID = 'grid grid-cols-[18mm_1fr_28mm_20mm_14mm] gap-2'

export function PicklijstDocument({ zendingen }: { zendingen: ZendingPrintSet[] }) {
  const { data: bedrijf } = useQuery({
    queryKey: ['bedrijfsgegevens'],
    queryFn: fetchBedrijfsConfig,
    staleTime: 5 * 60 * 1000,
  })
  const { rijen, totaalColli, totaalGewichtKg } = bouwPicklijst(zendingen)
  const datum = new Date().toLocaleDateString('nl-NL')

  return (
    <div className="picklijst-page bg-white text-slate-900" style={{ width: '210mm', minHeight: '297mm' }}>
      <div className="mx-auto flex min-h-[277mm] w-[190mm] flex-col px-4 py-6 font-mono text-[10px] leading-snug">
        {/* HEADER: logo gecentreerd, bedrijfsgegevens rechts (zoals pakbon) */}
        <header className="grid grid-cols-[1fr_auto_1fr] items-start gap-4">
          <div />
          <div className="text-center font-sans">
            <div className="text-[30px] font-bold leading-none tracking-[0.35em]">KARPI</div>
            <div className="mx-1 mt-1 border-t-2 border-slate-900" />
            <div className="mt-1 text-[13px] tracking-[0.45em]">GROUP</div>
          </div>
          <div className="text-right text-[9px] leading-snug font-sans">
            <div className="font-semibold">{bedrijf?.bedrijfsnaam ?? 'Karpi BV'}</div>
            <div>{bedrijf?.adres ?? ''}{bedrijf?.land ? `, ${bedrijf.postcode ?? ''} ${bedrijf.plaats ?? ''} (${bedrijf.land})` : ''}</div>
          </div>
        </header>

        {/* DOCUMENTTITEL + META --------------------------------------------- */}
        <div className="mt-10 grid grid-cols-2 items-start">
          <div className="text-center text-[20px] font-bold tracking-[0.25em]">Picklijst</div>
          <div className="space-y-0.5">
            <MetaRow label="Datum" value={datum} bold />
            <MetaRow label="Adressen" value={String(rijen.length)} />
          </div>
        </div>

        {/* TABELHEADER ------------------------------------------------------ */}
        <div className="mt-10">
          <DashedDivider />
          <div className={`${RIJ_GRID} py-0.5`}>
            <div>Debnr.</div>
            <div>Naam / adres / order(s)</div>
            <div className="text-right">Gewicht</div>
            <div className="text-right">Colli</div>
            <div className="text-center">Gepickt</div>
          </div>
          <DashedDivider />
        </div>

        {/* RIJEN ------------------------------------------------------------ */}
        <div className="mt-2 space-y-2">
          {rijen.map((r) => (
            <div key={r.zendingNr} className={`${RIJ_GRID} border-b border-dashed border-slate-300 pb-2`}>
              <div className="tabular-nums">{r.debiteurNr}</div>
              <div>
                <div className="font-semibold uppercase">{r.naam}</div>
                {r.adres && <div className="text-slate-600">{r.adres}</div>}
                {r.orderNrs.length > 0 && (
                  <div className="text-slate-600">{r.orderNrs.join(', ')}</div>
                )}
              </div>
              <div className="text-right tabular-nums">{formatNumber(r.gewichtKg, 2)}</div>
              <div className="text-right tabular-nums">{r.colli}</div>
              <div className="text-center text-slate-400">☐</div>
            </div>
          ))}
        </div>

        {/* TOTAALREGEL ------------------------------------------------------ */}
        <div className="mt-3">
          <DashedDivider />
          <div className={`${RIJ_GRID} py-1 font-semibold`}>
            <div className="col-span-2">Totaal deze picklijst</div>
            <div className="text-right tabular-nums">{formatNumber(totaalGewichtKg, 2)}</div>
            <div className="text-right tabular-nums">{totaalColli}</div>
            <div />
          </div>
          <DashedDivider />
        </div>

        <div className="flex-1" />
      </div>
    </div>
  )
}

function MetaRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="grid grid-cols-[30mm_1fr] gap-2">
      <span>{label}</span>
      <span className={bold ? 'font-semibold' : undefined}>: {value}</span>
    </div>
  )
}
