import { useQuery } from '@tanstack/react-query'
import { formatDate, formatNumber } from '@/lib/utils/formatters'
import { fetchBedrijfsConfig, type BedrijfsConfig } from '@/lib/supabase/queries/bedrijfsconfig'
import { productNamen } from '@/modules/logistiek/lib/shipping-label-data'
import { bouwVerzenddocument, type PakbonRegel } from '@/modules/logistiek/lib/printset'
import type { ZendingPrintSet } from '@/modules/logistiek/queries/zendingen'

interface PakbonDocumentProps {
  zending: ZendingPrintSet
  vervoerderNaam: string
  colliTotal: number
}

// Eenheid: 'm' voor rolproducten zou via producten.product_type lopen, maar in
// zendingen zijn het altijd telbare items uit voorraad/maatwerk → 'St'.
function eenheidVoor(): string {
  return 'St'
}

// Pakbon toont het land voluit zoals het oude Lieferschein ("DEUTSCHLAND");
// onbekende codes vallen terug op de code zelf.
const LAND_NAMEN: Record<string, string> = {
  NL: 'NEDERLAND',
  DE: 'DUITSLAND',
  BE: 'BELGIË',
  FR: 'FRANKRIJK',
  AT: 'OOSTENRIJK',
  LU: 'LUXEMBURG',
  CH: 'ZWITSERLAND',
  DK: 'DENEMARKEN',
}

function landNaam(code: string | null): string | null {
  if (!code) return null
  return LAND_NAMEN[code.toUpperCase()] ?? code
}

function DashedDivider() {
  return <div className="border-t border-dashed border-slate-700" />
}

// Kolomindeling van de artikeltabel — header en regels delen dit grid.
const REGEL_GRID = 'grid grid-cols-[10mm_30mm_1fr_16mm_18mm] gap-2'

export function PakbonDocument({ zending, vervoerderNaam: _vervoerderNaam, colliTotal }: PakbonDocumentProps) {
  const order = zending.orders
  const { data: bedrijf } = useQuery({
    queryKey: ['bedrijfsgegevens'],
    queryFn: fetchBedrijfsConfig,
    staleTime: 5 * 60 * 1000,
  })

  // Single source (refactor 2026-06-14): label én pakbon delen één
  // `bouwVerzenddocument`-expansie. `pakbonRegels` is al gefilterd (VERZEND),
  // gesorteerd op regelnummer en draagt de bevroren mig 388-snapshot + de
  // besteld/geleverd/gewicht-waarden — de pakbon doet alleen nog de presentatie.
  const doc = bouwVerzenddocument(zending)

  // Mig 222: bij bundel-zendingen regels groeperen op bron-order_id zodat het
  // pakbon-document onder elke order-sub-kop de bijbehorende regels toont.
  // Solo-zending: één groep — render-pad is identiek.
  const isBundel = zending.bundel_orders.length > 1
  const orderNrPerOrderId = new Map(zending.bundel_orders.map((bo) => [bo.id, bo.order_nr]))
  const regelsPerOrder = new Map<number, PakbonRegel[]>()
  for (const pr of doc.pakbonRegels) {
    const lijst = regelsPerOrder.get(pr.orderId) ?? []
    lijst.push(pr)
    regelsPerOrder.set(pr.orderId, lijst)
  }
  // Render-volgorde matcht bundel_orders (op order_nr) — als een regel bij een
  // niet-gevonden order-id hoort (mag niet, defensief), valt die achteraan.
  const orderIdRenderVolgorde: number[] = [
    ...zending.bundel_orders.map((bo) => bo.id).filter((id) => regelsPerOrder.has(id)),
    ...Array.from(regelsPerOrder.keys()).filter(
      (id) => !zending.bundel_orders.some((bo) => bo.id === id),
    ),
  ]

  const totaalGewicht = Number(zending.totaal_gewicht_kg ?? 0) || doc.totaalGewichtKg
  const kolli = colliTotal > 0 ? colliTotal : Number(zending.aantal_colli ?? 0)

  const klantNaam = order.fact_naam || order.debiteuren?.naam || ''
  const klantAdres = order.fact_adres ?? ''
  const klantPostcode = order.fact_postcode ?? ''
  const klantPlaats = order.fact_plaats ?? ''
  const klantLand = landNaam(order.fact_land)

  const aflLand = landNaam(zending.afl_land)
  const route = order.debiteuren?.route ?? null

  const referentieRegel =
    [order.klant_referentie, order.week ? `(WK ${order.week})` : null].filter(Boolean).join(' ') || '-'

  const vertegNaam = order.vertegenwoordigers?.naam ?? order.vertegenw_code ?? '-'
  const datum = formatDate(zending.verzenddatum ?? zending.created_at)

  return (
    <div className="pakbon-page bg-white text-slate-900" style={{ width: '210mm', minHeight: '297mm' }}>
      <div className="mx-auto flex min-h-[277mm] w-[190mm] flex-col px-4 py-6 font-mono text-[10px] leading-snug">
        {/* HEADER: logo gecentreerd, bedrijfsgegevens rechts (oude Lieferschein-vorm) */}
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
            {bedrijf?.telefoon && <div>t {bedrijf.telefoon}{bedrijf.fax ? ` | f ${bedrijf.fax}` : ''}</div>}
            <div>
              {bedrijf?.email && <span>e {bedrijf.email}</span>}
              {bedrijf?.email && bedrijf?.website && <span> | </span>}
              {bedrijf?.website && <span>i {bedrijf.website}</span>}
            </div>
          </div>
        </header>

        {/* DOCUMENTTITEL + PAKBONNR/DATUM ----------------------------------- */}
        <div className="mt-10 grid grid-cols-2 items-start">
          <div className="text-center text-[20px] font-bold tracking-[0.25em]">Pakbon</div>
          <div className="space-y-0.5">
            <MetaRow label="Pakbonnr" value={zending.zending_nr} bold />
            <MetaRow label="Datum" value={datum} />
          </div>
        </div>

        {/* AFLEVERADRES als hoofd-adresblok (rechts van het midden) --------- */}
        <section className="mt-8 grid grid-cols-2">
          <div />
          <div className="uppercase">
            <div>{zending.afl_naam ?? order.debiteuren?.naam ?? ''}</div>
            {order.afl_naam_2 && <div>{order.afl_naam_2}</div>}
            <div>{zending.afl_adres ?? ''}</div>
            <div>{zending.afl_postcode} {zending.afl_plaats ?? ''}</div>
            {aflLand && zending.afl_land !== 'NL' && <div>{aflLand}</div>}
            {zending.afl_telefoon && <div className="mt-3 normal-case">{zending.afl_telefoon}</div>}
          </div>
        </section>

        {/* REFERENTIEBLOK links + ROUTECODE rechts -------------------------- */}
        <section className="mt-6 grid grid-cols-2 items-start">
          <div className="space-y-0.5">
            {isBundel ? (
              <>
                <MetaRow label="Vertegenw." value={vertegNaam} />
                <MetaRow label="Debiteur" value={String(order.debiteur_nr)} />
                <MetaRow label="Orders" value={`${zending.bundel_orders.length} orders gebundeld`} />
                {zending.bundel_orders.map((bo) => {
                  const ref = [bo.klant_referentie, bo.week ? `(WK ${bo.week})` : null]
                    .filter(Boolean)
                    .join(' ') || '-'
                  return (
                    <div key={bo.id} className="ml-2 text-slate-700">
                      · {bo.order_nr} : Ref. {ref}
                    </div>
                  )
                })}
              </>
            ) : (
              <>
                <MetaRow label="Uw referentie" value={referentieRegel} />
                <MetaRow label="Vertegenw." value={vertegNaam} />
                <MetaRow label="Order/Debiteur" value={`${order.order_nr}/${order.debiteur_nr}`} />
              </>
            )}
          </div>
          <div>{route && <span>Routecode: {route}</span>}</div>
        </section>

        {/* TABELHEADER ------------------------------------------------------ */}
        <div className="mt-3">
          <DashedDivider />
          <div className={`${REGEL_GRID} py-0.5`}>
            <div>Rgl.</div>
            <div>Artikel</div>
            <div>Omschrijving</div>
            <div className="text-right">Besteld</div>
            <div className="text-right">Geleverd</div>
          </div>
          <DashedDivider />
        </div>

        {/* FACTUURADRES in de body (zoals "Rechnungsadresse") --------------- */}
        <section className="mt-2 grid grid-cols-[30mm_1fr] gap-2">
          <span>Factuuradres:</span>
          <span className="uppercase">
            <div>{klantNaam}</div>
            <div>{klantAdres}</div>
            <div>{klantPostcode} {klantPlaats}</div>
            {klantLand && order.fact_land !== 'NL' && <div>{klantLand}</div>}
          </span>
        </section>

        {/* ARTIKELREGELS ---------------------------------------------------- */}
        {/* Hoofdregel = Karpi's eigen omschrijving (zoals het oude document);
            de klanteigen naam volgt — alleen als die afwijkt — als sub-regel
            "Uw naam: …" (mirror van "Ihr Name" op het Lieferschein).
            Mig 222: bij bundel-zendingen krijgt elke bron-order een sub-kop boven
            zijn regels zodat magazijnier én ontvanger kunnen zien welke regel
            bij welke orderbevestiging hoort. */}
        <div className="mt-2 space-y-1">
          {orderIdRenderVolgorde.map((oid) => {
            const orderRegels = regelsPerOrder.get(oid) ?? []
            const orderNr = orderNrPerOrderId.get(oid)
            return (
              <div key={oid} className="space-y-1">
                {isBundel && orderNr && (
                  <div className="mt-2 border-t border-slate-300 pt-1 text-[10px] font-semibold uppercase tracking-wide">
                    Order {orderNr}
                  </div>
                )}
                {orderRegels.map((pr, idx) => {
                  const regel = pr.regel
                  const namen = productNamen(regel, pr.snapshot)
                  const hoofdNaam = namen.karpiNaam ?? namen.klantNaam
                  const toonUwNaam = namen.karpiNaam != null && namen.karpiNaam !== namen.klantNaam
                  const rgl = String(regel.order_regels?.regelnummer ?? idx + 1).padStart(2, '0')
                  return (
                    <div key={regel.id} className={REGEL_GRID}>
                      <div>{rgl}</div>
                      <div className="truncate">{regel.artikelnr ?? '-'}</div>
                      <div>
                        <div>{eenheidVoor()}&nbsp;&nbsp;{hoofdNaam}</div>
                        {/* Maat zit al in de bevroren omschrijving; aparte regel
                            alleen tonen bij legacy-zending zonder colli-snapshot. */}
                        {regel.order_regels?.is_maatwerk && !pr.snapshot && (
                          <div className="text-slate-600">
                            Op maat {regel.order_regels.maatwerk_breedte_cm ?? '-'} x{' '}
                            {regel.order_regels.maatwerk_lengte_cm ?? '-'} cm
                          </div>
                        )}
                        {toonUwNaam && <div>Uw naam: {namen.klantNaam}</div>}
                      </div>
                      <div className="text-right">{formatNumber(pr.besteld)}</div>
                      <div className="text-right">{formatNumber(pr.geleverd)}</div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* TOTALEN: kolli + gewicht ----------------------------------------- */}
        <div className="mt-6 space-y-0.5">
          <div className="grid grid-cols-[20mm_1fr] gap-2">
            <span>Kolli</span>
            <span>: {formatNumber(kolli)}</span>
          </div>
          {totaalGewicht > 0 && (
            <div className="grid grid-cols-[20mm_1fr] gap-2">
              <span>Gewicht</span>
              <span>: {formatNumber(totaalGewicht, 2)}</span>
            </div>
          )}
        </div>

        {/* SPACER + DISCLAIMER + FOOTER -------------------------------------- */}
        <div className="flex-1" />

        <div className="mb-4">
          EEN KLEINE MAATAFWIJKING (+/- 3%) EN<br />
          KLEURAFWIJKINGEN KUNNEN OPTREDEN
        </div>

        <FooterBlock bedrijf={bedrijf} />
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

function FooterBlock({ bedrijf }: { bedrijf: BedrijfsConfig | undefined }) {
  if (!bedrijf) return null
  const bankParts = [
    bedrijf.kvk && `k.v.k. ${bedrijf.kvk}`,
    bedrijf.btw_nummer && `btw ${bedrijf.btw_nummer}`,
    bedrijf.bank,
    bedrijf.iban && `IBAN ${bedrijf.iban}`,
    bedrijf.bic && `BIC ${bedrijf.bic}`,
  ].filter(Boolean) as string[]

  return (
    <div className="mt-2 text-center text-[8px] text-slate-700 font-sans">
      <div>{bankParts.join(' | ')}</div>
      {bedrijf.betalingscondities_tekst && (
        <div className="mt-1 whitespace-pre-line text-left text-[7px] leading-tight text-slate-600">
          {bedrijf.betalingscondities_tekst}
        </div>
      )}
    </div>
  )
}
