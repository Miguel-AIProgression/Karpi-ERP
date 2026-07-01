import { useState, useMemo } from 'react'
import {
  useKlantFactuurInstellingen,
  useUpdateKlantFactuurInstellingen,
} from '@/modules/facturatie'
import { FactuurLijst } from '@/modules/facturatie'
import { parseEmailRecipients } from '@/lib/email-recipients'
import { useAuth } from '@/hooks/use-auth'
import { substitueerPercentage, formatProcent } from '@/lib/orders/toeslag-regel'
import type { KlantFactuurInstellingen } from '@/modules/facturatie/queries/klant-factuur-instellingen'

interface Props {
  debiteurNr: number
  btwNummer: string | null
}

interface ToeslagEditFormProps {
  instellingen: KlantFactuurInstellingen
  onSave: (values: Partial<KlantFactuurInstellingen>) => void
  onCancel: () => void
  isSaving: boolean
}

function ToeslagEditForm({ instellingen, onSave, onCancel, isSaving }: ToeslagEditFormProps) {
  const [actief, setActief] = useState(instellingen.toeslag_actief ?? false)
  const [procent, setProcent] = useState(instellingen.toeslag_procent?.toString() ?? '')
  const [omschrijving, setOmschrijving] = useState(instellingen.toeslag_omschrijving ?? '')
  const [begindatum, setBegindatum] = useState(instellingen.toeslag_begindatum ?? '')
  const [einddatum, setEinddatum] = useState(instellingen.toeslag_einddatum ?? '')

  const procentNum = parseFloat(procent.replace(',', '.'))
  const procentGeldig = !Number.isNaN(procentNum) && procentNum > 0 && procentNum <= 100

  const datumFout = useMemo(() => {
    if (!actief) return null
    if (!begindatum || !einddatum) return null
    return einddatum <= begindatum ? 'Einddatum moet na begindatum liggen.' : null
  }, [actief, begindatum, einddatum])

  const preview = useMemo(() => {
    if (!actief || !omschrijving || !procentGeldig) return null
    return substitueerPercentage(omschrijving, procentNum)
  }, [actief, omschrijving, procentGeldig, procentNum])

  const kanOpslaan = !actief || (procentGeldig && begindatum && einddatum && !datumFout)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!kanOpslaan) return
    onSave({
      toeslag_actief: actief,
      toeslag_procent: actief && procentGeldig ? procentNum : null,
      toeslag_omschrijving: actief && omschrijving ? omschrijving : null,
      toeslag_begindatum: actief && begindatum ? begindatum : null,
      toeslag_einddatum: actief && einddatum ? einddatum : null,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-slate-50 rounded border border-slate-200">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={actief}
          onChange={(e) => setActief(e.currentTarget.checked)}
          className="h-4 w-4 rounded border-slate-300 accent-terracotta-500"
        />
        Toeslag actief
      </label>

      {actief && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex-1 max-w-[140px]">
              <label className="block text-xs text-slate-500 mb-1">Percentage</label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={procent}
                  onChange={(e) => setProcent(e.target.value)}
                  placeholder="4.5"
                  className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                />
                <span className="text-sm text-slate-500">%</span>
              </div>
              {procent && !procentGeldig && (
                <p className="text-xs text-red-600 mt-0.5">Ongeldig percentage.</p>
              )}
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">Begindatum</label>
              <input
                type="date"
                value={begindatum}
                onChange={(e) => setBegindatum(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500 mb-1">Einddatum</label>
              <input
                type="date"
                value={einddatum}
                onChange={(e) => setEinddatum(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              />
            </div>
          </div>

          {datumFout && <p className="text-xs text-red-600">{datumFout}</p>}

          <div>
            <label className="block text-xs text-slate-500 mb-1">
              Toeslagtekst (gebruik <code className="bg-slate-100 px-0.5 rounded">{'{percentage}'}</code> als plaatshouder)
            </label>
            <textarea
              value={omschrijving}
              onChange={(e) => setOmschrijving(e.target.value)}
              rows={3}
              placeholder="Wie vereinbart: Zuschlag von {percentage} % für den Zeitraum vom …"
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm resize-y"
            />
          </div>

          {preview && (
            <div className="p-2 bg-white border border-slate-200 rounded text-xs text-slate-600 italic">
              <span className="text-slate-400 not-italic">Voorbeeld: </span>
              &ldquo;{preview}&rdquo;
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isSaving || !kanOpslaan}
          className="text-xs px-3 py-1.5 rounded bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 disabled:opacity-50"
        >
          {isSaving ? 'Opslaan...' : 'Opslaan'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          Annuleren
        </button>
      </div>
    </form>
  )
}

export function KlantFactureringTab({ debiteurNr, btwNummer }: Props) {
  // Externe vertegenwoordiger (mig 489): read-only — geen wijzig-affordances.
  const { isExternRep } = useAuth()
  const { data: instellingen } = useKlantFactuurInstellingen(debiteurNr)
  const updateMut = useUpdateKlantFactuurInstellingen()

  const [editEmail, setEditEmail] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)

  const patch = (p: Parameters<typeof updateMut.mutate>[0]['patch']) =>
    updateMut.mutate({ debiteur_nr: debiteurNr, patch: p })

  const [toeslagEdit, setToeslagEdit] = useState(false)

  if (!instellingen) return null

  const { email_factuur: emailFactuur, btw_percentage: btwPercentage } = instellingen
  const toeslagActief = instellingen.toeslag_actief ?? false
  const verlegd = instellingen.btw_verlegd_intracom === true
  const btwWaarschuwing = (btwPercentage === 0 || verlegd) && !btwNummer

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Factuurvoorkeur</h3>
        {isExternRep ? (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              (instellingen.factuurvoorkeur ?? 'per_zending') === 'wekelijks'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-100 text-slate-500'
            }`}>
              {(instellingen.factuurvoorkeur ?? 'per_zending') === 'wekelijks' ? 'Wekelijks' : 'Per zending'}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="radio"
                name={`factuurvoorkeur-${debiteurNr}`}
                value="per_zending"
                checked={(instellingen.factuurvoorkeur ?? 'per_zending') === 'per_zending'}
                disabled={updateMut.isPending}
                onChange={() => patch({ factuurvoorkeur: 'per_zending' })}
                className="h-4 w-4 accent-terracotta-500"
              />
              <span>
                <strong>Per zending</strong> — factuur direct na elke verzending
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="radio"
                name={`factuurvoorkeur-${debiteurNr}`}
                value="wekelijks"
                checked={(instellingen.factuurvoorkeur ?? 'per_zending') === 'wekelijks'}
                disabled={updateMut.isPending}
                onChange={() => patch({ factuurvoorkeur: 'wekelijks' })}
                className="h-4 w-4 accent-terracotta-500"
              />
              <span>
                <strong>Wekelijks</strong> — één verzamelfactuur per week, verstuurd op maandag 06:00
              </span>
            </label>
          </div>
        )}
        <p className="mt-1 text-xs text-slate-400">
          Wekelijks: alle orders die in de vorige week zijn <em>verzonden</em> komen op één factuur met één factuurnummer.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">E-mailadres factuur</h3>
        {editEmail && !isExternRep ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const raw = (e.currentTarget.elements.namedItem('email_factuur') as HTMLInputElement).value
              const { normalized, invalid } = parseEmailRecipients(raw)
              if (invalid.length > 0) {
                setEmailError(`Ongeldig e-mailadres: ${invalid.join(', ')}`)
                return
              }
              setEmailError(null)
              updateMut.mutate(
                { debiteur_nr: debiteurNr, patch: { email_factuur: normalized === '' ? null : normalized } },
                { onSuccess: () => setEditEmail(false) },
              )
            }}
            className="flex flex-col gap-1"
          >
            <div className="flex items-center gap-2">
              {/* type="text" i.p.v. "email": de browser-validatie van type="email"
                  weigert meerdere adressen. We valideren zelf via parseEmailRecipients. */}
              <input
                name="email_factuur"
                type="text"
                defaultValue={emailFactuur ?? ''}
                autoFocus
                onChange={() => emailError && setEmailError(null)}
                placeholder="bv. invoice@klant.com, factuur@klant.com"
                className="w-96 rounded-[var(--radius-sm)] border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30"
              />
              <button
                type="submit"
                disabled={updateMut.isPending}
                className="text-xs px-2 py-1 rounded bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 disabled:opacity-50"
              >
                {updateMut.isPending ? 'Opslaan...' : 'Opslaan'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmailError(null)
                  setEditEmail(false)
                }}
                className="text-xs text-slate-500 hover:text-slate-700"
              >
                Annuleren
              </button>
            </div>
            {emailError && <p className="text-xs text-red-600">{emailError}</p>}
          </form>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            {emailFactuur
              ? <span className="text-slate-600">{emailFactuur}</span>
              : <span className="text-red-600">Niet ingesteld — zonder e-mailadres kan geen factuur verstuurd worden</span>}
            {!isExternRep && (
              <button
                type="button"
                onClick={() => setEditEmail(true)}
                className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium"
              >
                Wijzig
              </button>
            )}
          </div>
        )}
        <p className="mt-1 text-xs text-slate-400">
          Eén of meerdere ontvangers (scheiden met komma) — worden gebruikt door <code className="px-1 bg-slate-100 rounded">factuur-verzenden</code>.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">BTW verlegd (intracommunautair)</h3>
        {isExternRep ? (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              verlegd ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
            }`}>
              {verlegd ? 'Aan' : 'Uit'}
            </span>
            <span>BTW verleggen naar afnemer (EU B2B) — factuur en orderbevestiging rekenen 0%</span>
          </div>
        ) : (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={verlegd}
              disabled={updateMut.isPending}
              onChange={(e) => patch({ btw_verlegd_intracom: e.currentTarget.checked })}
              className="h-4 w-4 rounded border-slate-300 accent-terracotta-500"
            />
            <span>BTW verleggen naar afnemer (EU B2B) — factuur en orderbevestiging rekenen 0%</span>
          </label>
        )}
        {verlegd && (
          <p className="mt-1 text-xs text-slate-400">
            Effectief tarief: <strong>0%</strong> met vermelding &ldquo;BTW verlegd&rdquo; op de factuur.
            Het BTW-percentage hieronder is het NL-tarief en wordt genegeerd zolang verlegd aan staat.
            Geldt als default voor afleveringen binnen de EU — een order naar een ander land
            (bv. terug naar NL, of buiten de EU) wordt apart gesignaleerd op de factuur als
            &ldquo;BTW controle nodig&rdquo; (mig 456).
          </p>
        )}
        {btwWaarschuwing && (
          <p className="mt-2 text-xs text-amber-700">
            Let op: {verlegd ? 'BTW verlegd' : '0% BTW'} zonder btw-nummer. Intracommunautaire
            verlegging vereist een geldig btw-nummer bij de afnemer — vul dat in op de Info-tab.
          </p>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">BTW-percentage</h3>
        {isExternRep ? (
          <div className="flex items-center gap-1 text-sm text-slate-700">
            <span className="font-medium">{btwPercentage}</span>
            <span className="text-slate-500">%</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              min={0}
              max={100}
              defaultValue={btwPercentage}
              key={btwPercentage}
              onBlur={(e) => {
                const v = Number(e.currentTarget.value)
                if (!Number.isNaN(v) && v !== btwPercentage) patch({ btw_percentage: v })
              }}
              className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
            />
            <span className="text-sm text-slate-500">%</span>
            <button type="button" onClick={() => patch({ btw_percentage: 21 })}
              className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200">21% NL</button>
            <button type="button" onClick={() => patch({ btw_percentage: 0 })}
              className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200">0% EU/export</button>
          </div>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Factuurtoeslag</h3>
        {!toeslagEdit ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                toeslagActief ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {toeslagActief ? 'Aan' : 'Uit'}
              </span>
              {toeslagActief && instellingen.toeslag_procent != null && (
                <span className="text-sm text-slate-700">
                  {formatProcent(instellingen.toeslag_procent)}%
                  {instellingen.toeslag_begindatum && instellingen.toeslag_einddatum && (
                    <span className="text-slate-400 ml-1">
                      ({instellingen.toeslag_begindatum.split('-').reverse().join('-')} t/m {instellingen.toeslag_einddatum.split('-').reverse().join('-')})
                    </span>
                  )}
                </span>
              )}
              {!isExternRep && (
                <button
                  type="button"
                  onClick={() => setToeslagEdit(true)}
                  className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium"
                >
                  Wijzig
                </button>
              )}
            </div>
            {toeslagActief && instellingen.toeslag_omschrijving && instellingen.toeslag_procent != null && (
              <p className="text-xs text-slate-500 italic">
                &ldquo;{substitueerPercentage(instellingen.toeslag_omschrijving, instellingen.toeslag_procent)}&rdquo;
              </p>
            )}
            {toeslagActief && instellingen.toeslag_einddatum && (() => {
              const einddatum = new Date(instellingen.toeslag_einddatum)
              const dagenResterend = Math.floor((einddatum.getTime() - Date.now()) / 86400000)
              return dagenResterend <= 31 && dagenResterend >= 0 ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  Let op: de toeslag loopt af op {instellingen.toeslag_einddatum.split('-').reverse().join('-')} ({dagenResterend} dag{dagenResterend !== 1 ? 'en' : ''} resterend).
                </p>
              ) : null
            })()}
          </div>
        ) : (
          <ToeslagEditForm
            instellingen={instellingen}
            onSave={(values) => {
              patch(values)
              setToeslagEdit(false)
            }}
            onCancel={() => setToeslagEdit(false)}
            isSaving={updateMut.isPending}
          />
        )}
        <p className="mt-1 text-xs text-slate-400">
          Tijdgebonden procentuele toeslag op het product-subtotaal excl. verzendkosten — verschijnt als aparte regel op de order en factuur.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Facturen</h3>
        <FactuurLijst debiteurNr={debiteurNr} />
      </section>
    </div>
  )
}
