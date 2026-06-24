import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, Printer, Send, Undo2 } from 'lucide-react'
import {
  useMaakColliBundel,
  useMeldZendingHandmatigAan,
  useRhenusAanmelding,
  useVerwijderColliBundel,
  useZendingColliVoorBundel,
} from '@/modules/logistiek/hooks/use-colli-bundel'
// Deze POST-voltooi bundel-sectie (zending-detail) is Rhenus-only: alleen Rhenus
// heeft ná voltooien nog een venster (de 16:00-dagbatch, mig 484). HST bundelt óók
// (mig 485, op pallet) maar meldt direct aan — dat loopt via de "Colli bundelen"-knop
// TIJDENS de pickronde op de Verzendset-pagina (`ondersteuntColliBundelen`), niet hier.
import { isHandmatigAanmeldenVervoerder } from '@/modules/logistiek/lib/handmatig-aanmelden'
import { useAuth } from '@/hooks/use-auth'

interface Props {
  zendingId: number
  zendingNr: string
  vervoerderCode: string | null
  status: string
  aantalColli: number | null
}

export function ColliBundelSectie({ zendingId, zendingNr, vervoerderCode, status, aantalColli }: Props) {
  // Externe vertegenwoordiger (mig 489): read-only — de hele bundel-werkbank
  // (bundelen/ontbundelen/nu aanmelden) is verborgen.
  const { isExternRep } = useAuth()
  const zichtbaar =
    !isExternRep &&
    isHandmatigAanmeldenVervoerder(vervoerderCode) &&
    status === 'Klaar voor verzending' &&
    (aantalColli ?? 0) >= 2

  if (!zichtbaar) return null
  return (
    <ColliBundelSectieInner zendingId={zendingId} zendingNr={zendingNr} />
  )
}

function ColliBundelSectieInner({ zendingId, zendingNr }: { zendingId: number; zendingNr: string }) {
  const { data: colli = [], isLoading } = useZendingColliVoorBundel(zendingId)
  const { data: aanmelding } = useRhenusAanmelding(zendingId)
  const maak = useMaakColliBundel(zendingId)
  const verwijder = useVerwijderColliBundel(zendingId)
  const meldAan = useMeldZendingHandmatigAan(zendingId)

  const [geselecteerd, setGeselecteerd] = useState<Set<number>>(new Set())

  const losseColli = colli.filter((c) => !c.is_bundel && c.bundel_colli_id == null)
  const bundels = colli.filter((c) => c.is_bundel)
  const kinderenVan = (bundelId: number) => colli.filter((c) => c.bundel_colli_id === bundelId)

  // Voorgevulde maten/gewicht uit de selectie (Σ gewicht, MAX maat).
  const defaults = useMemo(() => {
    const sel = colli.filter((c) => geselecteerd.has(c.id))
    return {
      gewicht: sel.reduce((s, c) => s + (c.gewicht_kg ?? 0), 0),
      lengte: sel.reduce((m, c) => Math.max(m, c.lengte_cm ?? 0), 0),
      breedte: sel.reduce((m, c) => Math.max(m, c.breedte_cm ?? 0), 0),
    }
  }, [colli, geselecteerd])

  const [gewicht, setGewicht] = useState('')
  const [lengte, setLengte] = useState('')
  const [breedte, setBreedte] = useState('')

  // Sinds mig 465 wordt een Rhenus-zending na voltooien automatisch ge-enqueued
  // (dagbatch 16:00) — er is dus meteen een 'Wachtrij'-rij. Bundelen mag zolang
  // de zending nog NIET verstuurd is; pas bij 'Bezig'/'Verstuurd' is het te laat.
  const verstuurd = aanmelding?.status === 'Bezig' || aanmelding?.status === 'Verstuurd'
  const inWachtrij = aanmelding?.status === 'Wachtrij'
  const kanBundelen = geselecteerd.size >= 2 && !verstuurd

  function toggle(id: number) {
    setGeselecteerd((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setGewicht(''); setLengte(''); setBreedte('')
  }

  function bundel() {
    maak.mutate(
      {
        colliIds: [...geselecteerd],
        gewichtKg: parseOrDefault(gewicht, defaults.gewicht),
        lengteCm: parseOrDefault(lengte, defaults.lengte),
        breedteCm: parseOrDefault(breedte, defaults.breedte),
      },
      {
        onSuccess: () => {
          setGeselecteerd(new Set())
          setGewicht(''); setLengte(''); setBreedte('')
        },
      },
    )
  }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-terracotta-200 p-5 mb-6">
      <h3 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-2">
        <Boxes size={16} className="text-terracotta-600" /> Colli bundelen (Rhenus)
      </h3>

      {verstuurd ? (
        <p className="text-sm text-emerald-700 mb-2">
          Aangemeld bij Rhenus (status: {aanmelding!.status}). Bundelen is niet meer mogelijk.
        </p>
      ) : (
        <p className="text-xs text-slate-500 mb-3">
          Pak een paar colli samen in één zak: vink ze aan → <strong>Bundelen</strong> → print de
          nieuwe sticker en plak die op de zak. Geen bundel nodig? Je hoeft niets te doen — deze
          zending wordt <strong>automatisch om 16:00</strong> in de Rhenus-dagbatch aangemeld.
        </p>
      )}

      {isLoading ? (
        <div className="text-sm text-slate-400">Colli laden…</div>
      ) : (
        <>
          {/* Bestaande bundels */}
          {bundels.length > 0 && (
            <div className="mb-4 space-y-2">
              {bundels.map((b) => (
                <div key={b.id} className="rounded-[var(--radius-sm)] border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-slate-700">
                      {b.klant_omschrijving_snapshot ?? 'Bundel'}{' '}
                      <span className="font-mono text-xs text-slate-500">{b.sscc}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Toont ALLE verzendstickers (losse colli + deze bundel) —
                          niet alleen de bundel. De gebundelde kind-colli vallen weg
                          (die zitten in de zak). Geen `?colli=`-filter meer. */}
                      <Link
                        to={`/logistiek/${zendingNr}/printset`}
                        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                      >
                        <Printer size={13} /> Verzendstickers
                      </Link>
                      {!verstuurd && (
                        <button
                          onClick={() => verwijder.mutate(b.id)}
                          disabled={verwijder.isPending}
                          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                        >
                          <Undo2 size={13} /> Ontbundelen
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {kinderenVan(b.id).map((k) => k.omschrijving_snapshot ?? `Colli ${k.colli_nr}`).join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Losse colli met checkboxes */}
          {!verstuurd && (
            <div className="space-y-1.5">
              {losseColli.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={geselecteerd.has(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <span className="font-mono text-xs text-slate-400 w-8">#{c.colli_nr}</span>
                  <span className="flex-1">{c.omschrijving_snapshot ?? `Colli ${c.colli_nr}`}</span>
                  <span className="text-xs text-slate-400">
                    {c.gewicht_kg != null ? `${c.gewicht_kg} kg` : '—'}
                  </span>
                </label>
              ))}
              {losseColli.length === 0 && (
                <div className="text-sm text-slate-400">Geen losse colli meer om te bundelen.</div>
              )}
            </div>
          )}

          {/* Bundel-formulier (≥2 geselecteerd) */}
          {kanBundelen && (
            <div className="mt-4 rounded-[var(--radius-sm)] border border-slate-200 p-3">
              <div className="text-xs font-semibold text-slate-600 mb-2">
                {geselecteerd.size} colli bundelen — controleer gewicht/maat van de zak:
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <MaatVeld label="Gewicht (kg)" value={gewicht} ph={String(round1(defaults.gewicht))} onChange={setGewicht} />
                <MaatVeld label="Lengte (cm)" value={lengte} ph={String(defaults.lengte)} onChange={setLengte} />
                <MaatVeld label="Breedte (cm)" value={breedte} ph={String(defaults.breedte)} onChange={setBreedte} />
                <button
                  onClick={bundel}
                  disabled={maak.isPending}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-terracotta-600 px-3 py-2 text-sm font-medium text-white hover:bg-terracotta-700 disabled:opacity-50"
                >
                  <Boxes size={15} /> Bundel maken
                </button>
              </div>
            </div>
          )}

          {maak.isError && (
            <div className="mt-2 text-xs text-rose-600">Bundelen mislukt: {(maak.error as Error).message}</div>
          )}
          {verwijder.isError && (
            <div className="mt-2 text-xs text-rose-600">Ontbundelen mislukt: {(verwijder.error as Error).message}</div>
          )}

          {/* Dagbatch-status + escape-hatch. Na voltooien staat de zending al in
              de wachtrij; ze gaat automatisch om 16:00 mee. "Nu aanmelden"
              vervroegt naar de eerstvolgende cron-run voor een urgente zending. */}
          {inWachtrij && (
            <>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <p className="text-xs text-slate-500">
                  Staat klaar — wordt <strong>automatisch om 16:00</strong> bij Rhenus aangemeld.
                </p>
                <button
                  onClick={() => meldAan.mutate()}
                  disabled={meldAan.isPending}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-emerald-600 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                >
                  <Send size={15} /> Nu aanmelden (niet wachten)
                </button>
              </div>
              {meldAan.isError && (
                <div className="mt-2 text-xs text-rose-600 text-right">
                  Aanmelden mislukt: {(meldAan.error as Error).message}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function MaatVeld({
  label, value, ph, onChange,
}: { label: string; value: string; ph: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        placeholder={ph}
        onChange={(e) => onChange(e.target.value)}
        className="w-28 rounded-[var(--radius-sm)] border border-slate-300 px-2 py-1.5 text-sm"
      />
    </div>
  )
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function parseOrDefault(s: string, d: number): number {
  const n = parseFloat(s)
  return Number.isNaN(n) ? d : n
}
