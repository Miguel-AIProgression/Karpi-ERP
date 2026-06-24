/**
 * Deep module: de canonieke debiteur-veldset.
 *
 * Eén bron van waarheid voor de velden van een klant — gedeeld door zowel
 * "Klant toevoegen" (debiteur-add-dialog) als "Klant bewerken"
 * (debiteur-edit-dialog), zodat ze niet meer uit elkaar kunnen lopen
 * ("dezelfde velden + gelinkt", klantverzoek 24-06-2026).
 *
 * Interface (simpel) -> implementatie (rijk):
 *   - `DebiteurFormValues`       form-state (alles als string/boolean)
 *   - `emptyDebiteurForm`        defaults voor aanmaken
 *   - `debiteurFormFromDetail`   bestaande klant -> form-state (bewerken)
 *   - `debiteurFormToDb`         form-state -> exacte DB-kolommen (insert + update)
 *   - `valideerDebiteurForm`     validatie (één plek)
 *   - `<DebiteurFormFields>`     de invoer-UI (secties, e-mail-per-document, prijslijst)
 *
 * De aanroepers (de twee dialogs) zijn daardoor dunne schillen rond deze module.
 */
import { useActieveBetaalcondities } from '@/hooks/use-betaalcondities'
import { formatBetaalconditie } from '@/lib/supabase/queries/betaalcondities'
import { isEuLand } from '@/lib/orders/btw'
import { landNaarIso2 } from '@/lib/utils/land-vlag'
import { usePrijslijstHeadersList } from '../hooks/use-debiteuren'
import type { DebiteurDetail } from '../queries/debiteuren'

export const inputClasses =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400'

const sectionLabel = 'text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2'

export type DebiteurFormValues = {
  naam: string
  status: string
  // Hoofd-/bezoekadres — tevens het default aflever-adres-snapshot bij orders
  // (order-form valt hierop terug als er geen los afleveradres gekozen is).
  adres: string
  postcode: string
  plaats: string
  land: string
  // Factuuradres — apart van het hoofdadres. Leeg = hoofdadres op de factuur.
  fact_naam: string
  fact_adres: string
  fact_postcode: string
  fact_plaats: string
  telefoon: string
  // E-mail per documenttype — zie EMAIL_VELDEN voor de betekenis.
  email_factuur: string
  email_overig: string
  email_verzend: string
  email_pakbon: string
  // Fiscaal & commercieel
  btw_nummer: string
  btw_verlegd_intracom: boolean
  btw_percentage: string
  gln_bedrijf: string
  korting_pct: string
  betaalconditie_code: string
  prijslijst_nr: string
}

export const emptyDebiteurForm: DebiteurFormValues = {
  naam: '',
  status: 'Actief',
  adres: '',
  postcode: '',
  plaats: '',
  land: 'NL',
  fact_naam: '',
  fact_adres: '',
  fact_postcode: '',
  fact_plaats: '',
  telefoon: '',
  email_factuur: '',
  email_overig: '',
  email_verzend: '',
  email_pakbon: '',
  btw_nummer: '',
  btw_verlegd_intracom: false,
  btw_percentage: '21',
  gln_bedrijf: '',
  korting_pct: '',
  betaalconditie_code: '',
  prijslijst_nr: '',
}

/**
 * Single source: welk e-mailVELD op de debiteur stuurt welk DOCUMENT.
 * Voedt de labels + hints in het formulier én documenteert de mapping.
 */
export const EMAIL_VELDEN: {
  key: 'email_factuur' | 'email_overig' | 'email_verzend' | 'email_pakbon'
  label: string
  hint: string
  placeholder: string
}[] = [
  {
    key: 'email_factuur',
    label: 'Facturen',
    hint: 'Ontvanger van de factuur (factuur-verzenden). Eén of meerdere adressen, komma-gescheiden.',
    placeholder: 'factuur@klant.nl, kopie@klant.nl',
  },
  {
    key: 'email_overig',
    label: 'Orderbevestigingen',
    hint: 'Ontvanger van de orderbevestiging. Leeg = valt terug op het factuuradres.',
    placeholder: 'verkoop@klant.nl',
  },
  {
    key: 'email_verzend',
    label: 'Verzending / track & trace',
    hint: 'Ontvanger van de T&T-mail via de vervoerder. Leeg = geen T&T-mail (geen fout).',
    placeholder: 'magazijn@klant.nl',
  },
  {
    key: 'email_pakbon',
    label: 'Pakbon (optioneel)',
    hint: 'Apart adres voor de pakbon. Leeg = huidige werkwijze (pakbon als bijlage bij de factuurmail).',
    placeholder: 'pakbon@klant.nl',
  },
]

const trimOrNull = (v: string) => {
  const t = v.trim()
  return t === '' ? null : t
}

const parseNum = (v: string) => (v.trim() === '' ? 0 : Number(v.replace(',', '.')))

/** Pakt de code uit een opgeslagen "CODE - Naam"-betaalconditie. */
export function extractBetaalconditieCode(raw: string | null): string {
  if (!raw) return ''
  const m = raw.match(/^\s*([^\s-][^-]*?)\s*-/)
  return m ? m[1].trim() : ''
}

export function debiteurFormFromDetail(k: DebiteurDetail): DebiteurFormValues {
  return {
    naam: k.naam ?? '',
    status: k.status ?? 'Actief',
    adres: k.adres ?? '',
    postcode: k.postcode ?? '',
    plaats: k.plaats ?? '',
    land: k.land ?? '',
    fact_naam: k.fact_naam ?? '',
    fact_adres: k.fact_adres ?? '',
    fact_postcode: k.fact_postcode ?? '',
    fact_plaats: k.fact_plaats ?? '',
    telefoon: k.telefoon ?? '',
    email_factuur: k.email_factuur ?? '',
    email_overig: k.email_overig ?? '',
    email_verzend: k.email_verzend ?? '',
    email_pakbon: k.email_pakbon ?? '',
    btw_nummer: k.btw_nummer ?? '',
    btw_verlegd_intracom: k.btw_verlegd_intracom ?? false,
    btw_percentage: k.btw_percentage != null ? String(k.btw_percentage) : '21',
    gln_bedrijf: k.gln_bedrijf ?? '',
    korting_pct: k.korting_pct != null ? String(k.korting_pct) : '',
    betaalconditie_code: extractBetaalconditieCode(k.betaalconditie),
    prijslijst_nr: k.prijslijst_nr ?? '',
  }
}

export function valideerDebiteurForm(v: DebiteurFormValues): string | null {
  if (!v.naam.trim()) return 'Naam is verplicht'
  const korting = parseNum(v.korting_pct)
  if (Number.isNaN(korting) || korting < 0 || korting > 100) {
    return 'Korting moet tussen 0 en 100 liggen'
  }
  const btw = parseNum(v.btw_percentage)
  if (Number.isNaN(btw) || btw < 0 || btw > 100) {
    return 'BTW-percentage moet tussen 0 en 100 liggen'
  }
  return null
}

type Conditie = { code: string; naam: string }

/**
 * Vertaalt de form-state naar de exacte `debiteuren`-kolommen.
 * Gedeeld door INSERT (aanmaken) en UPDATE (bewerken).
 *
 * @param origineleBetaalconditie  bij bewerken: de opgeslagen "CODE - Naam"
 *   zodat een ongewijzigde (ook niet-meer-in-de-lijst) conditie exact behouden
 *   blijft.
 */
export function debiteurFormToDb(
  v: DebiteurFormValues,
  condities: Conditie[],
  origineleBetaalconditie?: string | null,
): Record<string, unknown> {
  let betaalconditie: string | null
  if (v.betaalconditie_code === '') {
    betaalconditie = null
  } else if (
    origineleBetaalconditie != null &&
    v.betaalconditie_code === extractBetaalconditieCode(origineleBetaalconditie)
  ) {
    betaalconditie = origineleBetaalconditie
  } else {
    const picked = condities.find((c) => c.code === v.betaalconditie_code)
    betaalconditie = picked ? `${picked.code} - ${picked.naam}` : (origineleBetaalconditie ?? null)
  }

  return {
    naam: v.naam.trim().toUpperCase(), // debiteurnamen zijn per conventie uppercase
    status: v.status,
    adres: trimOrNull(v.adres),
    postcode: trimOrNull(v.postcode),
    plaats: trimOrNull(v.plaats),
    land: trimOrNull(v.land),
    fact_naam: trimOrNull(v.fact_naam),
    fact_adres: trimOrNull(v.fact_adres),
    fact_postcode: trimOrNull(v.fact_postcode),
    fact_plaats: trimOrNull(v.fact_plaats),
    telefoon: trimOrNull(v.telefoon),
    email_factuur: trimOrNull(v.email_factuur),
    email_overig: trimOrNull(v.email_overig),
    email_verzend: trimOrNull(v.email_verzend),
    email_pakbon: trimOrNull(v.email_pakbon),
    btw_nummer: trimOrNull(v.btw_nummer),
    btw_verlegd_intracom: v.btw_verlegd_intracom,
    btw_percentage: parseNum(v.btw_percentage),
    gln_bedrijf: trimOrNull(v.gln_bedrijf),
    korting_pct: parseNum(v.korting_pct),
    betaalconditie,
    prijslijst_nr: trimOrNull(v.prijslijst_nr),
  }
}

/**
 * Leidt de BTW-verlegd-vlag af uit het (debiteur-)land: een EU-land buiten NL
 * (intracommunautaire B2B) → verlegd. NL of buiten de EU → niet (export-0% wordt
 * apart per order/factuur bepaald, mig 455). Hergebruikt de single-source
 * `isEuLand` + `landNaarIso2` — geen eigen EU-lijst.
 */
export function btwVerlegdVoorLand(land: string): boolean {
  const iso2 = landNaarIso2(land)
  return !!iso2 && iso2 !== 'NL' && isEuLand(iso2)
}

interface FieldsProps {
  values: DebiteurFormValues
  onChange: (patch: Partial<DebiteurFormValues>) => void
}

export function DebiteurFormFields({ values, onChange }: FieldsProps) {
  const { data: condities } = useActieveBetaalcondities()
  const { data: headers } = usePrijslijstHeadersList()
  const prijslijsten = (headers ?? []).filter((h) => h.actief)

  const set =
    (key: keyof DebiteurFormValues) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      onChange({ [key]: e.target.value } as Partial<DebiteurFormValues>)

  const currentCode = values.betaalconditie_code
  const knownCodes = new Set((condities ?? []).map((c) => c.code))
  const orphanConditie = currentCode !== '' && !knownCodes.has(currentCode)

  const prijslijstOnbekend =
    values.prijslijst_nr !== '' && !prijslijsten.some((h) => h.nr === values.prijslijst_nr)

  return (
    <div className="space-y-4">
      {/* Basis */}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-slate-500 mb-1">
            Naam <span className="text-rose-500">*</span>
          </label>
          <input type="text" value={values.naam} onChange={set('naam')} required placeholder="Bedrijfsnaam" className={inputClasses} />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Status</label>
          <select value={values.status} onChange={set('status')} className={inputClasses}>
            <option value="Actief">Actief</option>
            <option value="Inactief">Inactief</option>
          </select>
        </div>
      </div>

      {/* Hoofdadres */}
      <div className="pt-2">
        <div className={sectionLabel}>Adres (hoofd/bezoek — tevens default afleveradres)</div>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-3">
            <label className="block text-xs text-slate-500 mb-1">Straat + nummer</label>
            <input type="text" value={values.adres} onChange={set('adres')} placeholder="Voorbeeldstraat 1" className={inputClasses} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Postcode</label>
            <input type="text" value={values.postcode} onChange={set('postcode')} placeholder="1234 AB" className={inputClasses} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Plaats</label>
            <input type="text" value={values.plaats} onChange={set('plaats')} placeholder="Amsterdam" className={inputClasses} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Land</label>
            {/* Land stuurt de BTW-verlegd-vlag (EU buiten NL → verlegd), zie checkbox onderaan. */}
            <input
              type="text"
              value={values.land}
              onChange={(e) =>
                onChange({ land: e.target.value, btw_verlegd_intracom: btwVerlegdVoorLand(e.target.value) })
              }
              placeholder="NL"
              className={inputClasses}
            />
          </div>
        </div>
      </div>

      {/* Factuuradres */}
      <div className="pt-2">
        <div className={sectionLabel}>Factuuradres (leeg = hoofdadres wordt gebruikt)</div>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-3">
            <label className="block text-xs text-slate-500 mb-1">Naam</label>
            <input type="text" value={values.fact_naam} onChange={set('fact_naam')} placeholder="t.a.v. crediteurenadministratie" className={inputClasses} />
          </div>
          <div className="col-span-3">
            <label className="block text-xs text-slate-500 mb-1">Straat + nummer</label>
            <input type="text" value={values.fact_adres} onChange={set('fact_adres')} className={inputClasses} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Postcode</label>
            <input type="text" value={values.fact_postcode} onChange={set('fact_postcode')} className={inputClasses} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-slate-500 mb-1">Plaats</label>
            <input type="text" value={values.fact_plaats} onChange={set('fact_plaats')} className={inputClasses} />
          </div>
        </div>
      </div>

      {/* Contact */}
      <div className="pt-2">
        <div className={sectionLabel}>Contact</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs text-slate-500 mb-1">Telefoon</label>
            <input type="tel" value={values.telefoon} onChange={set('telefoon')} placeholder="+31 20 123 4567" className={inputClasses} />
          </div>
        </div>
      </div>

      {/* E-mail per documenttype */}
      <div className="pt-2">
        <div className={sectionLabel}>E-mailadressen per document</div>
        <div className="grid grid-cols-1 gap-3">
          {EMAIL_VELDEN.map((veld) => (
            <div key={veld.key}>
              <label className="block text-xs text-slate-500 mb-1">{veld.label}</label>
              {/* type="text" i.p.v. "email": browser-validatie weigert meerdere komma-gescheiden adressen. */}
              <input
                type="text"
                value={values[veld.key]}
                onChange={set(veld.key)}
                placeholder={veld.placeholder}
                className={inputClasses}
              />
              <p className="text-xs text-slate-400 mt-1">{veld.hint}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Prijslijst */}
      <div className="pt-2">
        <div className={sectionLabel}>Prijslijst</div>
        <select value={values.prijslijst_nr} onChange={set('prijslijst_nr')} className={inputClasses}>
          <option value="">— Geen —</option>
          {prijslijstOnbekend && <option value={values.prijslijst_nr}>{values.prijslijst_nr} (inactief / onbekend)</option>}
          {prijslijsten.map((h) => (
            <option key={h.nr} value={h.nr}>
              {h.nr} — {h.naam}
            </option>
          ))}
        </select>
        <p className="text-xs text-amber-700 mt-1">
          Verplicht om later een order te kunnen aanmaken — zonder prijslijst weigert het systeem de order.
        </p>
      </div>

      {/* Fiscaal & commercieel */}
      <div className="pt-2">
        <div className={sectionLabel}>Fiscaal &amp; commercieel</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">BTW-nummer</label>
            <input type="text" value={values.btw_nummer} onChange={set('btw_nummer')} placeholder="NL123456789B01" className={inputClasses} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">GLN moederbedrijf</label>
            <input type="text" value={values.gln_bedrijf} onChange={set('gln_bedrijf')} className={inputClasses} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Korting (%)</label>
            <input type="number" step="0.01" min="0" max="100" value={values.korting_pct} onChange={set('korting_pct')} className={inputClasses} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">BTW-percentage (%)</label>
            <input type="number" step="0.01" min="0" max="100" value={values.btw_percentage} onChange={set('btw_percentage')} className={inputClasses} />
          </div>
          <div className="col-span-2">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={values.btw_verlegd_intracom}
                onChange={(e) => onChange({ btw_verlegd_intracom: e.currentTarget.checked })}
                className="h-4 w-4 rounded border-slate-300 accent-terracotta-500"
              />
              <span>BTW verlegd (intracommunautair, EU B2B) — factuur en orderbevestiging rekenen 0%</span>
            </label>
            <p className="text-xs text-slate-400 mt-1">
              Wordt automatisch afgeleid uit het land (EU buiten NL → verlegd). Handmatig aan te passen.
            </p>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-slate-500 mb-1">Betaalconditie</label>
            <select value={values.betaalconditie_code} onChange={set('betaalconditie_code')} className={inputClasses}>
              <option value="">— Geen —</option>
              {orphanConditie && <option value={currentCode}>{currentCode} (niet in lijst)</option>}
              {(condities ?? []).map((c) => (
                <option key={c.code} value={c.code}>
                  {formatBetaalconditie(c)}
                  {c.dagen != null ? ` (${c.dagen} dgn)` : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">
              Beheer de lijst via <code className="px-1 mx-0.5 bg-slate-100 rounded">Instellingen → Betaalcondities</code>.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
