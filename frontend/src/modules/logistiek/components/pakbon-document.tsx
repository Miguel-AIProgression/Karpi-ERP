import { useQuery } from '@tanstack/react-query'
import { formatDate, formatNumber } from '@/lib/utils/formatters'
import { fetchBedrijfsConfig, type BedrijfsConfig } from '@/lib/supabase/queries/bedrijfsconfig'
import { isShippingRegel } from '@/modules/logistiek/lib/is-shipping-regel'
import type { ZendingPrintRegel, ZendingPrintSet } from '@/modules/logistiek/queries/zendingen'

interface PakbonDocumentProps {
  zending: ZendingPrintSet
  vervoerderNaam: string
  colliTotal: number
}

interface RegelNamen {
  /** Naam zoals de klant 'm in z'n eigen administratie kent (klanteigen-alias of fallback). */
  klantNaam: string
  /** Karpi's eigen product-omschrijving uit `producten.omschrijving`. NULL als producten-join leeg is. */
  karpiNaam: string | null
}

function regelNamen(regel: ZendingPrintRegel): RegelNamen {
  const orderRegel = regel.order_regels
  if (!orderRegel) {
    return { klantNaam: regel.artikelnr ?? 'Artikel', karpiNaam: null }
  }
  const klantNaam = [orderRegel.omschrijving, orderRegel.omschrijving_2].filter(Boolean).join(' ')
  const karpiNaam = orderRegel.producten?.omschrijving ?? null
  return { klantNaam: klantNaam || (regel.artikelnr ?? 'Artikel'), karpiNaam }
}

function geleverdAantal(regel: ZendingPrintRegel): number {
  return Number(regel.aantal ?? regel.order_regels?.te_leveren ?? regel.order_regels?.orderaantal ?? 1)
}

// m² per stuk, vorm-aware. Maatwerk gebruikt eigen oppervlak; vaste producten vallen
// terug op product-dimensies (rond → π·r², rest → l·b).
function oppervlakM2PerStuk(regel: ZendingPrintRegel): number {
  const r = regel.order_regels
  if (!r) return 0
  if (r.maatwerk_oppervlak_m2 != null) return Number(r.maatwerk_oppervlak_m2)
  if (r.is_maatwerk && r.maatwerk_lengte_cm && r.maatwerk_breedte_cm) {
    return (Number(r.maatwerk_lengte_cm) * Number(r.maatwerk_breedte_cm)) / 10000
  }
  const p = r.producten
  if (!p?.lengte_cm || !p?.breedte_cm) return 0
  if (p.vorm === 'rond') {
    return Math.PI * Math.pow(Number(p.lengte_cm) / 200, 2)
  }
  return (Number(p.lengte_cm) * Number(p.breedte_cm)) / 10000
}

function regelGewichtKg(regel: ZendingPrintRegel): number {
  const r = regel.order_regels
  if (!r) return 0
  return Number(r.gewicht_kg ?? r.producten?.gewicht_kg ?? 0)
}

// Eenheid: 'm' voor rolproducten zou via producten.product_type lopen, maar in
// zendingen zijn het altijd telbare items uit voorraad/maatwerk → 'St'.
function eenheidVoor(_regel: ZendingPrintRegel): string {
  return 'St'
}

interface DashedDividerProps {
  double?: boolean
}
function DashedDivider({ double }: DashedDividerProps) {
  if (double) {
    return (
      <>
        <div className="border-t border-dashed border-slate-700" />
        <div className="mt-1 border-t border-dashed border-slate-700" />
      </>
    )
  }
  return <div className="border-t border-dashed border-slate-700" />
}

export function PakbonDocument({ zending, vervoerderNaam: _vervoerderNaam, colliTotal: _colliTotal }: PakbonDocumentProps) {
  const order = zending.orders
  const { data: bedrijf } = useQuery({
    queryKey: ['bedrijfsgegevens'],
    queryFn: fetchBedrijfsConfig,
    staleTime: 5 * 60 * 1000,
  })

  // Service-regels (verzendkosten) horen niet op de pakbon — alleen op de factuur.
  // `isShippingRegel` checkt zowel zending_regels.artikelnr (post-mig 169) als
  // order_regels.artikelnr (fallback voor oude zendingen waar de snapshot leeg is).
  const regels = zending.zending_regels
    .filter((r) => !isShippingRegel(r))
    .sort((a, b) => {
      const ar = a.order_regels?.regelnummer ?? 0
      const br = b.order_regels?.regelnummer ?? 0
      return ar - br
    })

  const totaalM2 = regels.reduce((sum, r) => sum + oppervlakM2PerStuk(r) * geleverdAantal(r), 0)
  const totaalGewicht =
    Number(zending.totaal_gewicht_kg ?? 0) ||
    regels.reduce((sum, r) => sum + regelGewichtKg(r) * geleverdAantal(r), 0)

  const klantNaam = order.fact_naam || order.debiteuren?.naam || ''
  const klantAdres = order.fact_adres ?? ''
  const klantPostcode = order.fact_postcode ?? ''
  const klantPlaats = order.fact_plaats ?? ''
  const klantLand = order.fact_land ?? ''

  const referentieRegel =
    [order.klant_referentie, order.week ? `(WK ${order.week})` : null].filter(Boolean).join(' ') || '-'

  const vertegNaam = order.vertegenwoordigers?.naam ?? order.vertegenw_code ?? '-'
  const datum = formatDate(zending.verzenddatum ?? zending.created_at)

  return (
    <div className="pakbon-page bg-white text-slate-900" style={{ width: '210mm', minHeight: '297mm' }}>
      <div className="mx-auto flex min-h-[277mm] w-[190mm] flex-col px-4 py-6 font-mono text-[10px] leading-snug">
        {/* HEADER ----------------------------------------------------------- */}
        <header className="mb-6 grid grid-cols-[1fr_75mm] items-start gap-6">
          <div>
            <div className="font-sans text-[34px] font-bold tracking-[0.30em] leading-none">KARP<span className="font-sans">i</span></div>
            <div className="font-sans mt-1 text-[14px] tracking-[0.40em] text-slate-600">GROUP</div>
          </div>
          <div className="text-right text-[10px] leading-snug font-sans">
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

        {/* KLANTBLOK + META ------------------------------------------------- */}
        <section className="mb-6 grid grid-cols-[1fr_85mm] gap-6">
          <div className="font-sans uppercase">
            <div>{klantNaam}</div>
            <div>{klantAdres}</div>
            <div>{klantPostcode} {klantPlaats}</div>
            {klantLand && klantLand !== 'NL' && <div>{klantLand}</div>}
          </div>
          <div className="font-sans space-y-0.5 text-[10px]">
            <MetaRow label="Uw debiteurnummer" value={String(order.debiteur_nr)} />
            <MetaRow label="Pakbonnummer" value={zending.zending_nr} />
            <MetaRow label="Pakbondatum" value={datum} />
            <MetaRow label="Vertegenwoordiger" value={vertegNaam} />
          </div>
        </section>

        {/* TABELHEADER ------------------------------------------------------ */}
        <DashedDivider />
        <div className="grid grid-cols-[28mm_18mm_10mm_1fr] gap-3 py-1 text-[10px]">
          <div>Artikel</div>
          <div className="text-right">Aantal</div>
          <div>Eh</div>
          <div>Omschrijving</div>
        </div>
        <DashedDivider />

        {/* ORDER-BLOK ------------------------------------------------------- */}
        <section className="mt-4 mb-2">
          <BlockRow label="Ons Ordernummer" value={order.order_nr} />
          <BlockRow label="Uw Referentie" value={referentieRegel} />
          <BlockRow
            label="Afleveradres"
            value={
              <>
                <div>{(zending.afl_naam ?? order.debiteuren?.naam ?? '').toUpperCase()}</div>
                {order.afl_naam_2 && <div>{order.afl_naam_2.toUpperCase()}</div>}
                <div>{(zending.afl_adres ?? '').toUpperCase()}</div>
                <div>{zending.afl_postcode} {(zending.afl_plaats ?? '').toUpperCase()}</div>
                {zending.afl_land && zending.afl_land !== 'NL' && <div>{zending.afl_land}</div>}
              </>
            }
          />
        </section>

        {/* ARTIKELREGELS ---------------------------------------------------- */}
        {/* Pakbon toont eerst de klanteigen-naam (zodat de ontvanger 'm herkent) en
            daaronder — alleen als die afwijkt — de Karpi-eigen artikelnaam, zodat
            magazijn-/retourcontroles altijd terug kunnen vallen op de bron. */}
        <div className="mt-4 space-y-1">
          {regels.map((regel) => {
            const namen = regelNamen(regel)
            const toonKarpi = namen.karpiNaam && namen.karpiNaam !== namen.klantNaam
            return (
              <div key={regel.id} className="grid grid-cols-[28mm_18mm_10mm_1fr] gap-3">
                <div className="truncate">{regel.artikelnr ?? '-'}</div>
                <div className="text-right">{formatNumber(geleverdAantal(regel))}</div>
                <div>{eenheidVoor(regel)}</div>
                <div>
                  <div>{namen.klantNaam}</div>
                  {toonKarpi && (
                    <div className="text-slate-500">Karpi: {namen.karpiNaam}</div>
                  )}
                  {regel.order_regels?.is_maatwerk && (
                    <div className="text-slate-600">
                      Op maat {regel.order_regels.maatwerk_breedte_cm ?? '-'} x{' '}
                      {regel.order_regels.maatwerk_lengte_cm ?? '-'} cm
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* TOTAALREGEL ------------------------------------------------------ */}
        <div className="mt-4 flex gap-8">
          <div>Totaal m2: {formatNumber(totaalM2, 2)}</div>
          {totaalGewicht > 0 && (
            <div>Totaal gewicht (kg): {formatNumber(totaalGewicht, 2)}</div>
          )}
        </div>

        {/* SPACER + FOOTER -------------------------------------------------- */}
        <div className="flex-1" />

        <DashedDivider double />
        <FooterBlock bedrijf={bedrijf} />
      </div>
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[40mm_1fr] gap-2">
      <span>{label}</span>
      <span>: {value}</span>
    </div>
  )
}

function BlockRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[28mm_1fr] gap-3">
      <span>{label}</span>
      <span>: {value}</span>
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
