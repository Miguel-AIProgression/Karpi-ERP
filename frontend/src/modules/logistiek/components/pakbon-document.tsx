import { formatDate, formatNumber } from '@/lib/utils/formatters'
import type { ZendingPrintRegel, ZendingPrintSet } from '@/modules/logistiek/queries/zendingen'

interface PakbonDocumentProps {
  zending: ZendingPrintSet
  vervoerderNaam: string
  colliTotal: number
}

function regelOmschrijving(regel: ZendingPrintRegel): string {
  const orderRegel = regel.order_regels
  if (!orderRegel) return regel.artikelnr ?? 'Artikel'
  return [orderRegel.omschrijving, orderRegel.omschrijving_2].filter(Boolean).join(' ')
}

function geleverdAantal(regel: ZendingPrintRegel): number {
  return Number(regel.aantal ?? regel.order_regels?.te_leveren ?? regel.order_regels?.orderaantal ?? 1)
}

export function PakbonDocument({ zending, vervoerderNaam, colliTotal }: PakbonDocumentProps) {
  const order = zending.orders
  const regels = [...zending.zending_regels].sort((a, b) => {
    const ar = a.order_regels?.regelnummer ?? 0
    const br = b.order_regels?.regelnummer ?? 0
    return ar - br
  })
  const totaalGeleverd = regels.reduce((sum, regel) => sum + geleverdAantal(regel), 0)

  return (
    <div className="pakbon-page bg-white text-slate-950" style={{ width: '210mm', minHeight: '297mm' }}>
      <div className="mx-auto flex min-h-[277mm] w-[190mm] flex-col px-4 py-6 text-[11px] leading-relaxed">
        <header className="mb-8 grid grid-cols-[1fr_70mm] gap-6">
          <div className="text-center">
            <div className="text-3xl font-semibold tracking-[0.28em]">KARPI</div>
            <div className="mt-1 text-lg tracking-[0.25em]">GROUP</div>
            <div className="mt-8 text-xl font-medium">PAKBON</div>
          </div>
          <div className="text-right text-[10px] leading-snug">
            <div className="font-semibold">Karpi BV</div>
            <div>Textielstraat 15</div>
            <div>7122 LB Aalten</div>
            <div className="mt-2">info@karpi.nl</div>
            <div>www.karpi.nl</div>
          </div>
        </header>

        <section className="mb-6 grid grid-cols-[1fr_72mm] gap-8">
          <div className="space-y-1">
            <div>
              <span className="inline-block w-24 text-slate-500">Referentie</span>
              {order.klant_referentie ?? '-'}
            </div>
            <div>
              <span className="inline-block w-24 text-slate-500">Bonnr./verz.</span>
              {zending.zending_nr}
            </div>
            <div>
              <span className="inline-block w-24 text-slate-500">Ordernummer</span>
              {order.order_nr}
            </div>
            <div>
              <span className="inline-block w-24 text-slate-500">Vervoerder</span>
              {vervoerderNaam}
            </div>
          </div>
          <div className="uppercase leading-relaxed">
            <div className="font-semibold">{zending.afl_naam ?? order.debiteuren?.naam}</div>
            <div>{zending.afl_adres}</div>
            <div>
              {zending.afl_postcode} {zending.afl_plaats}
            </div>
            <div>{zending.afl_land ?? 'NL'}</div>
            <div className="mt-5 normal-case">
              <span className="text-slate-500">Datum:</span>{' '}
              {formatDate(zending.verzenddatum ?? zending.created_at)}
            </div>
          </div>
        </section>

        <table className="mb-6 w-full border-collapse text-[10px]">
          <thead>
            <tr className="border-y border-slate-400 text-left text-slate-500">
              <th className="w-10 py-1 font-medium">Regel</th>
              <th className="w-28 py-1 font-medium">Artikel</th>
              <th className="py-1 font-medium">Omschrijving</th>
              <th className="w-16 py-1 text-right font-medium">Besteld</th>
              <th className="w-16 py-1 text-right font-medium">Geleverd</th>
            </tr>
          </thead>
          <tbody>
            {regels.map((regel) => (
              <tr key={regel.id} className="align-top">
                <td className="py-1 pr-2 text-slate-500">{regel.order_regels?.regelnummer ?? '-'}</td>
                <td className="py-1 pr-2 font-mono text-[9px]">{regel.artikelnr ?? '-'}</td>
                <td className="py-1 pr-2">
                  <div className="font-medium">{regelOmschrijving(regel)}</div>
                  {regel.order_regels?.is_maatwerk && (
                    <div className="text-[9px] text-slate-500">
                      Op maat {regel.order_regels.maatwerk_breedte_cm ?? '-'} x{' '}
                      {regel.order_regels.maatwerk_lengte_cm ?? '-'} cm
                    </div>
                  )}
                </td>
                <td className="py-1 text-right">{formatNumber(regel.order_regels?.orderaantal ?? 0)}</td>
                <td className="py-1 text-right">{formatNumber(geleverdAantal(regel))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="mt-auto grid grid-cols-2 gap-10 text-[10px]">
          <div>
            <div>Colli: {formatNumber(colliTotal)}</div>
            <div>Geleverd: {formatNumber(totaalGeleverd)}</div>
            <div>
              Gewicht:{' '}
              {zending.totaal_gewicht_kg != null
                ? `${formatNumber(Number(zending.totaal_gewicht_kg))} kg`
                : '-'}
            </div>
          </div>
          <div className="text-right text-slate-500">
            Een geringe maatafwijking (+/- 3%) of kleurafwijking kan optreden.
          </div>
        </section>
      </div>
    </div>
  )
}
