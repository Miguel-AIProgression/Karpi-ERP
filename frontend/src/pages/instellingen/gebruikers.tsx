import { useState } from 'react'
import { UserPlus, KeyRound, Ban, CircleCheck, Trash2, ShieldOff } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useAuth } from '@/hooks/use-auth'
import {
  useGebruikers,
  useGenereerLoginLink,
  useBlokkeerGebruiker,
  useVerwijderGebruiker,
  useSetPaginaRestricties,
} from '@/hooks/use-gebruikers'
import { UitnodigGebruikerDialog } from '@/components/instellingen/uitnodig-gebruiker-dialog'
import { LinkDelenDialog } from '@/components/instellingen/link-delen'
import type { GebruikerRow } from '@/lib/supabase/queries/gebruikers'

/** Pagina's die een beheerder per gebruiker kan blokkeren. */
const BESCHIKBARE_PAGINAS: { pad: string; label: string }[] = [
  { pad: '/inkoop', label: 'Inkooporders' },
  { pad: '/leveranciers', label: 'Leveranciers' },
  { pad: '/edi/berichten', label: 'EDI berichten' },
  { pad: '/facturatie', label: 'Facturatie' },
  { pad: '/logistiek', label: 'Logistiek / zendingen' },
]

function formatDatum(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatusBadge({ gebruiker }: { gebruiker: GebruikerRow }) {
  if (gebruiker.geblokkeerd) {
    return (
      <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-rose-50 text-rose-700">
        Geblokkeerd
      </span>
    )
  }
  if (gebruiker.uitnodiging_openstaand) {
    return (
      <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-amber-50 text-amber-700">
        Uitnodiging open
      </span>
    )
  }
  return (
    <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-emerald-50 text-emerald-700">
      Actief
    </span>
  )
}

function ToegangDialog({
  gebruiker,
  onClose,
}: {
  gebruiker: GebruikerRow
  onClose: () => void
}) {
  const [restricties, setRestricties] = useState<string[]>(gebruiker.pagina_restricties)
  const [fout, setFout] = useState<string | null>(null)
  const mut = useSetPaginaRestricties()

  const toggle = (pad: string) => {
    setRestricties((prev) =>
      prev.includes(pad) ? prev.filter((p) => p !== pad) : [...prev, pad],
    )
  }

  const handleOpslaan = async () => {
    setFout(null)
    try {
      await mut.mutateAsync({ id: gebruiker.id, paden: restricties })
      onClose()
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Opslaan mislukt')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-[var(--radius-sm)] border border-slate-200 shadow-xl w-full max-w-sm mx-4 p-5">
        <h2 className="text-base font-semibold text-slate-800 mb-1">Paginatoegang</h2>
        <p className="text-sm text-slate-500 mb-4">
          Vink pagina's aan die <strong>{gebruiker.email}</strong> <em>niet</em> mag zien.
        </p>

        <div className="space-y-2 mb-5">
          {BESCHIKBARE_PAGINAS.map(({ pad, label }) => (
            <label key={pad} className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={restricties.includes(pad)}
                onChange={() => toggle(pad)}
                className="h-4 w-4 rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400"
              />
              <span className="text-sm text-slate-700 group-hover:text-slate-900">{label}</span>
            </label>
          ))}
        </div>

        {fout && (
          <div className="mb-3 px-3 py-2 bg-rose-50 border border-rose-100 text-xs text-rose-700 rounded-[var(--radius-sm)]">
            {fout}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-[var(--radius-sm)] border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Annuleren
          </button>
          <button
            onClick={handleOpslaan}
            disabled={mut.isPending}
            className="px-3 py-1.5 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white hover:bg-terracotta-600 disabled:opacity-50"
          >
            {mut.isPending ? 'Opslaan…' : 'Opslaan'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function GebruikersInstellingenPage() {
  const { user } = useAuth()
  const { data: gebruikers, isLoading, error } = useGebruikers()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [actieFout, setActieFout] = useState<string | null>(null)
  const [bezigId, setBezigId] = useState<string | null>(null)
  const [gedeeldeLink, setGedeeldeLink] = useState<{ email: string; link: string } | null>(null)
  const [toegangGebruiker, setToegangGebruiker] = useState<GebruikerRow | null>(null)

  const linkMut = useGenereerLoginLink()
  const blokkeerMut = useBlokkeerGebruiker()
  const verwijderMut = useVerwijderGebruiker()

  const handleReset = async (g: GebruikerRow) => {
    if (!g.email) return
    setActieFout(null)
    setBezigId(g.id)
    try {
      const { link } = await linkMut.mutateAsync({ email: g.email })
      setGedeeldeLink({ email: g.email, link })
    } catch (err) {
      setActieFout(err instanceof Error ? err.message : 'Link genereren mislukt')
    } finally {
      setBezigId(null)
    }
  }

  const handleBlokkeer = async (g: GebruikerRow) => {
    setActieFout(null)
    setBezigId(g.id)
    try {
      await blokkeerMut.mutateAsync({ id: g.id, blokkeren: !g.geblokkeerd })
    } catch (err) {
      setActieFout(err instanceof Error ? err.message : 'Actie mislukt')
    } finally {
      setBezigId(null)
    }
  }

  const handleVerwijder = async (g: GebruikerRow) => {
    if (!window.confirm(`Account ${g.email ?? g.id} definitief verwijderen?`)) return
    setActieFout(null)
    setBezigId(g.id)
    try {
      await verwijderMut.mutateAsync(g.id)
    } catch (err) {
      setActieFout(err instanceof Error ? err.message : 'Verwijderen mislukt')
    } finally {
      setBezigId(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Gebruikers"
        description="Inlog-accounts voor het portaal. Maak een account aan en deel de wachtwoord-link zelf met de collega; zij stellen daarmee hun eigen wachtwoord in."
        actions={
          <button
            onClick={() => setDialogOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600"
          >
            <UserPlus size={16} />
            Gebruiker toevoegen
          </button>
        }
      />

      {actieFout && (
        <div className="mb-4 px-3 py-2 bg-rose-50 border border-rose-100 text-sm text-rose-700 rounded-[var(--radius-sm)]">
          {actieFout}
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-slate-500">Laden…</div>
      ) : error ? (
        <div className="px-4 py-8 text-center text-sm text-rose-700 bg-rose-50 rounded-[var(--radius-sm)] border border-rose-100">
          Kon gebruikers niet laden: {error instanceof Error ? error.message : 'onbekende fout'}
        </div>
      ) : !gebruikers || gebruikers.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500 bg-slate-50 rounded-[var(--radius-sm)] border border-slate-200">
          Nog geen gebruikers. Klik op "Gebruiker uitnodigen" om te beginnen.
        </div>
      ) : (
        <div className="bg-white rounded-[var(--radius-sm)] border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">E-mailadres</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Geblokkeerde pagina's</th>
                <th className="px-4 py-2 font-medium">Laatste login</th>
                <th className="px-4 py-2 font-medium">Aangemaakt</th>
                <th className="px-4 py-2 text-right font-medium">Acties</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gebruikers.map((g) => {
                const isZelf = user?.id === g.id
                const bezig = bezigId === g.id
                const restricties = g.pagina_restricties ?? []
                return (
                  <tr key={g.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-800">
                      {g.email ?? '—'}
                      {isZelf && (
                        <span className="ml-2 text-xs text-slate-400">(jij)</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge gebruiker={g} />
                    </td>
                    <td className="px-4 py-2">
                      {restricties.length === 0 ? (
                        <span className="text-slate-400 text-xs">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {restricties.map((pad) => {
                            const label = BESCHIKBARE_PAGINAS.find((p) => p.pad === pad)?.label ?? pad
                            return (
                              <span
                                key={pad}
                                className="inline-block px-1.5 py-0.5 text-xs rounded-full bg-orange-50 text-orange-700 border border-orange-100"
                              >
                                {label}
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{formatDatum(g.laatste_login)}</td>
                    <td className="px-4 py-2 text-slate-600">{formatDatum(g.aangemaakt_op)}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          title="Wachtwoord-/login-link genereren"
                          disabled={bezig || !g.email}
                          onClick={() => handleReset(g)}
                          className="p-1.5 rounded-[var(--radius-sm)] text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40"
                        >
                          <KeyRound size={16} />
                        </button>
                        {!isZelf && (
                          <button
                            title="Paginatoegang beheren"
                            disabled={bezig}
                            onClick={() => setToegangGebruiker(g)}
                            className="p-1.5 rounded-[var(--radius-sm)] text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40"
                          >
                            <ShieldOff size={16} />
                          </button>
                        )}
                        {!isZelf && (
                          <button
                            title={g.geblokkeerd ? 'Deblokkeren' : 'Blokkeren'}
                            disabled={bezig}
                            onClick={() => handleBlokkeer(g)}
                            className="p-1.5 rounded-[var(--radius-sm)] text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40"
                          >
                            {g.geblokkeerd ? <CircleCheck size={16} /> : <Ban size={16} />}
                          </button>
                        )}
                        {!isZelf && (
                          <button
                            title="Account verwijderen"
                            disabled={bezig}
                            onClick={() => handleVerwijder(g)}
                            className="p-1.5 rounded-[var(--radius-sm)] text-rose-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {dialogOpen && <UitnodigGebruikerDialog onClose={() => setDialogOpen(false)} />}

      {gedeeldeLink && (
        <LinkDelenDialog
          titel="Wachtwoord-link"
          beschrijving={`Stuur deze link naar ${gedeeldeLink.email}. Daarmee stelt diegene een nieuw wachtwoord in.`}
          link={gedeeldeLink.link}
          onClose={() => setGedeeldeLink(null)}
        />
      )}

      {toegangGebruiker && (
        <ToegangDialog
          gebruiker={toegangGebruiker}
          onClose={() => setToegangGebruiker(null)}
        />
      )}
    </>
  )
}
