import { useState } from 'react'
import {
  useKlantFactuurInstellingen,
  useUpdateKlantFactuurInstellingen,
} from '@/modules/facturatie'
import { FactuurLijst } from '@/modules/facturatie'
import { parseEmailRecipients } from '@/lib/email-recipients'

interface Props {
  debiteurNr: number
  btwNummer: string | null
}

export function KlantFactureringTab({ debiteurNr, btwNummer }: Props) {
  const { data: instellingen } = useKlantFactuurInstellingen(debiteurNr)
  const updateMut = useUpdateKlantFactuurInstellingen()

  const [editEmail, setEditEmail] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)

  const patch = (p: Parameters<typeof updateMut.mutate>[0]['patch']) =>
    updateMut.mutate({ debiteur_nr: debiteurNr, patch: p })

  if (!instellingen) return null

  const { email_factuur: emailFactuur, btw_percentage: btwPercentage } = instellingen
  const verlegd = instellingen.btw_verlegd_intracom === true
  const btwWaarschuwing = (btwPercentage === 0 || verlegd) && !btwNummer

  return (
    <div className="space-y-6">
      {/* Factuurvoorkeur-sectie verwijderd per ADR-0010: factuur volgt voortaan altijd de bundel-zending in de wekelijkse cron. */}

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">E-mailadres factuur</h3>
        {editEmail ? (
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
            <button
              type="button"
              onClick={() => setEditEmail(true)}
              className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium"
            >
              Wijzig
            </button>
          </div>
        )}
        <p className="mt-1 text-xs text-slate-400">
          Eén of meerdere ontvangers (scheiden met komma) — worden gebruikt door <code className="px-1 bg-slate-100 rounded">factuur-verzenden</code>.
        </p>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">BTW verlegd (intracommunautair)</h3>
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
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Facturen</h3>
        <FactuurLijst debiteurNr={debiteurNr} />
      </section>
    </div>
  )
}
