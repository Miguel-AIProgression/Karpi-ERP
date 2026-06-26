import { useQuery } from '@tanstack/react-query'
import { formatNumber } from '@/lib/utils/formatters'
import { fetchBedrijfsConfig } from '@/lib/supabase/queries/bedrijfsconfig'
import { hstDepotVoorPostcode } from '@/modules/logistiek/lib/hst-depot'
import { fetchAfwerkingTypes } from '@/modules/maatwerk/queries/maatwerk-runtime'
import type { AfwerkingTypeMap } from '@/lib/orders/afwerking-presentatie'
import type { ZendingPrintSet } from '@/modules/logistiek/queries/zendingen'
// Single source (Pakbondocument-consolidatie 2026-06-19, ADR-0033): de geprinte
// pakbon en de factuurmail-PDF zijn dunne renderers op hetzelfde canonieke
// `PakbonDocument`. Deze component leidt niets meer zelf af — alle presentatie-
// beslissingen (adres, naam, referentie, bundel-groepering, totalen) komen uit
// `bouwPakbonDocument`. De routecode is print-only render-context die hier wordt
// geïnjecteerd (HST-depot), niet door het document bezeten.
import { bouwPakbonDocument } from '../../../../../supabase/functions/_shared/pakbon/pakbon-document'

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

function DashedDivider() {
  return <div className="border-t border-dashed border-slate-700" />
}

// Kolomindeling van de artikeltabel — header en regels delen dit grid.
const REGEL_GRID = 'grid grid-cols-[10mm_30mm_1fr_16mm_18mm] gap-2'

export function PakbonDocument({ zending, vervoerderNaam: _vervoerderNaam, colliTotal }: PakbonDocumentProps) {
  const { data: bedrijf } = useQuery({
    queryKey: ['bedrijfsgegevens'],
    queryFn: fetchBedrijfsConfig,
    staleTime: 5 * 60 * 1000,
  })
  const { data: afwerkingTypesRaw } = useQuery({
    queryKey: ['afwerking-types'],
    queryFn: fetchAfwerkingTypes,
    staleTime: 5 * 60 * 1000,
  })
  const afwerkingTypes: AfwerkingTypeMap = new Map(
    (afwerkingTypesRaw ?? []).map((a) => [a.code, { naam: a.naam, type_bewerking: a.type_bewerking }]),
  )

  // Routecode = HST-depotnummer uit de postcodeverdeling (zelfde lookup als op
  // het verzendlabel). Alléén bij HST: andere vervoerders (Rhenus/Verhoek) kennen
  // dit depot-concept niet. Print-only — gaat dus NIET de factuurmail-PDF in.
  const routecode =
    zending.vervoerder_code === 'hst_api'
      ? hstDepotVoorPostcode(zending.afl_postcode, zending.afl_land)
      : null

  const doc = bouwPakbonDocument(zending, { kolli: colliTotal, routecode, afwerkingTypes })

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
            <MetaRow label="Pakbonnr" value={doc.pakbonnr} bold />
            <MetaRow label="Datum" value={doc.datum} />
          </div>
        </div>

        {/* Mig 473: deze zending dekt niet de hele order — niet missen op de werkvloer. */}
        {doc.isDeelzending && (
          <div className="mt-2 inline-block self-start border-2 border-slate-900 px-2 py-1 font-sans text-[11px] font-bold tracking-wide">
            DEELZENDING — niet de volledige order
          </div>
        )}

        {/* AFLEVERADRES als hoofd-adresblok (rechts van het midden) --------- */}
        <section className="mt-8 grid grid-cols-2">
          <div />
          <div className="uppercase">
            {doc.afleveradres.map((regel, i) => (
              <div key={i}>{regel}</div>
            ))}
            {doc.afleverTelefoon && <div className="mt-3 normal-case">{doc.afleverTelefoon}</div>}
          </div>
        </section>

        {/* REFERENTIEBLOK links + ROUTECODE rechts -------------------------- */}
        <section className="mt-6 grid grid-cols-2 items-start">
          <div className="space-y-0.5">
            {doc.isBundel ? (
              <>
                <MetaRow label="Vertegenw." value={doc.vertegenwoordiger} />
                <MetaRow label="Debiteur" value={doc.debiteur} />
                <MetaRow label="Orders" value={`${doc.bundelRegels.length} orders gebundeld`} />
                {doc.bundelRegels.map((regel, i) => (
                  <div key={i} className="ml-2 text-slate-700">
                    {regel}
                  </div>
                ))}
              </>
            ) : (
              <>
                <MetaRow label="Uw referentie" value={doc.referentieRegel} />
                <MetaRow label="Vertegenw." value={doc.vertegenwoordiger} />
                <MetaRow label="Order/Debiteur" value={doc.orderDebiteur} />
              </>
            )}
          </div>
          <div>{doc.routecode && <span>Routecode: {doc.routecode}</span>}</div>
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
            {doc.factuuradres.map((regel, i) => (
              <div key={i}>{regel}</div>
            ))}
          </span>
        </section>

        {/* ARTIKELREGELS ---------------------------------------------------- */}
        {/* Hoofdregel = Karpi's eigen omschrijving (zoals het oude document);
            de klanteigen naam volgt — alleen als die afwijkt — als sub-regel
            "Uw naam: …" (mirror van "Ihr Name" op het Lieferschein).
            Mig 222: bij bundel-zendingen krijgt elke bron-order een sub-kop boven
            zijn regels. Alle beslissingen zijn al genomen in `bouwPakbonDocument`. */}
        <div className="mt-2 space-y-1">
          {doc.groepen.map((groep) => (
            <div key={groep.orderId} className="space-y-1">
              {doc.isBundel && groep.orderNr && (
                <div className="mt-2 border-t border-slate-300 pt-1 text-[10px] font-semibold uppercase tracking-wide">
                  Order {groep.orderNr}
                </div>
              )}
              {groep.regels.map((r, idx) => (
                <div key={`${groep.orderId}-${r.regelnummer}-${idx}`} className={REGEL_GRID}>
                  <div>{r.regelnummer}</div>
                  <div className="truncate">{r.artikelnr}</div>
                  <div>
                    <div>{eenheidVoor()}&nbsp;&nbsp;{r.hoofdNaam}</div>
                    {r.maatRegel && <div className="text-slate-600">{r.maatRegel}</div>}
                    {r.afwerkingRegel && <div className="text-slate-600">Afwerking: {r.afwerkingRegel}</div>}
                    {/* Mig 436: omsticker — fysiek gepakt equivalent, zelfde
                        "OMB:"-notatie als het verzendlabel. */}
                    {r.omstickerCodes.length > 0 && (
                      <div className="text-slate-600">OMB: {r.omstickerCodes.join(', ')}</div>
                    )}
                    {r.uwNaam && <div>Uw model: {r.uwNaam}</div>}
                  </div>
                  <div className="text-right">{r.besteld}</div>
                  <div className="text-right">
                    {r.geleverd}
                    {/* Mig 516: niet-gevonden colli (manco) blijft op de pakbon
                        staan met geleverd 0 + een duidelijk MANCO-label. */}
                    {r.isManco && <div className="font-bold">MANCO</div>}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* TOTALEN: kolli + gewicht ----------------------------------------- */}
        <div className="mt-6 space-y-0.5">
          <div className="grid grid-cols-[20mm_1fr] gap-2">
            <span>Kolli</span>
            <span>: {formatNumber(doc.kolli)}</span>
          </div>
          {doc.totaalGewichtKg > 0 && (
            <div className="grid grid-cols-[20mm_1fr] gap-2">
              <span>Gewicht</span>
              <span>: {formatNumber(doc.totaalGewichtKg, 2)}</span>
            </div>
          )}
        </div>

        {/* SPACER + DISCLAIMER + FOOTER -------------------------------------- */}
        <div className="flex-1" />

        <div className="mb-4">
          EEN KLEINE MAATAFWIJKING (+/- 3%) EN<br />
          KLEURAFWIJKINGEN KUNNEN OPTREDEN
        </div>
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
