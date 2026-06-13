import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Building2,
  Check,
  ClipboardCopy,
  Eye,
  EyeOff,
  KeyRound,
  PackageSearch,
  Pencil,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/page-header'
import { useLeverancierDetail, LeverancierFormDialog, LeverancierStatsCard } from '@/modules/inkoop'
import { LeverancierOpenRegels } from '../components/leverancier-open-regels'
import {
  stellPortalCredentialsIn,
  verwijderPortalToegang,
  fetchLeverancierPortalToken,
} from '../queries/leveranciers'

// VITE_PORTAL_HTML_URL = base URL where docs/portal/index.html is hosted (no trailing slash)
// e.g. https://miguel-aiprogression.github.io/Karpi-ERP/portal
// Accessible from China; falls back to Supabase domain placeholder if not configured.
const PORTAL_HTML_BASE = import.meta.env.VITE_PORTAL_HTML_URL ?? ''
const PORTAL_LOGIN_URL = PORTAL_HTML_BASE ? `${PORTAL_HTML_BASE}/index.html` : '#portal-url-not-configured'

// ── PortalToegang ──────────────────────────────────────────────────────────────
function PortalToegang({ leverancierId, leverancierNaam, portalEmail }: {
  leverancierId: number
  leverancierNaam: string
  portalEmail: string | null
}) {
  const qc = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [email, setEmail] = useState(portalEmail ?? '')
  const [wachtwoord, setWachtwoord] = useState('')
  const [wachtwoord2, setWachtwoord2] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const saveMutation = useMutation({
    mutationFn: () => stellPortalCredentialsIn(leverancierId, email, wachtwoord),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leveranciers', 'detail', leverancierId] })
      setFormOpen(false)
      setWachtwoord('')
      setWachtwoord2('')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => verwijderPortalToegang(leverancierId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leveranciers', 'detail', leverancierId] })
      setConfirmDelete(false)
    },
  })

  const pwMatch = wachtwoord === wachtwoord2
  const pwOk = wachtwoord.length >= 6
  const canSave = email.includes('@') && pwOk && pwMatch

  function openForm() {
    setEmail(portalEmail ?? '')
    setWachtwoord('')
    setWachtwoord2('')
    setFormOpen(true)
  }

  async function copyInvite() {
    const text = `You can access the Karpi supplier portal at:\n${PORTAL_LOGIN_URL}\n\nUsername: ${portalEmail ?? email}`
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <section className="bg-white rounded-[var(--radius)] border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-slate-400" />
          <h2 className="font-medium">Portal toegang</h2>
        </div>
        {portalEmail && !formOpen && (
          <button
            onClick={openForm}
            className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1"
          >
            <Pencil size={12} /> Wijzigen
          </button>
        )}
      </div>

      {!portalEmail && !formOpen && (
        <div className="text-center py-6">
          <ShieldAlert size={28} className="text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500 mb-3">
            {leverancierNaam} heeft nog geen portal-login.
          </p>
          <button
            onClick={openForm}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-700"
          >
            <KeyRound size={14} /> Portal-login aanmaken
          </button>
        </div>
      )}

      {portalEmail && !formOpen && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-800 truncate">{portalEmail}</div>
              <div className="text-xs text-slate-500 mt-0.5">Wachtwoord ingesteld ·{' '}
                <a href={PORTAL_LOGIN_URL} target="_blank" rel="noreferrer"
                  className="text-blue-600 hover:underline">
                  {PORTAL_LOGIN_URL}
                </a>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={copyInvite}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              {copied ? <Check size={13} className="text-green-500" /> : <ClipboardCopy size={13} />}
              {copied ? 'Gekopieerd!' : 'Kopieer uitnodigingstekst'}
            </button>

            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
              >
                <Trash2 size={13} /> Verwijder toegang
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600">Zeker weten?</span>
                <button
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                >
                  Ja, verwijder
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50"
                >
                  Annuleer
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {formOpen && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="leverancier@bedrijf.com"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Wachtwoord {portalEmail && <span className="text-slate-400">(laat leeg = ongewijzigd)</span>}
            </label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={wachtwoord}
                onChange={(e) => setWachtwoord(e.target.value)}
                placeholder="Min. 6 tekens"
                className="w-full px-3 py-2 pr-9 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
              <button type="button" onClick={() => setShowPw(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          {wachtwoord && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Bevestig wachtwoord</label>
              <input
                type={showPw ? 'text' : 'password'}
                value={wachtwoord2}
                onChange={(e) => setWachtwoord2(e.target.value)}
                placeholder="Herhaal wachtwoord"
                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400
                  ${wachtwoord2 && !pwMatch ? 'border-red-300' : 'border-slate-300'}`}
              />
              {wachtwoord2 && !pwMatch && (
                <p className="text-xs text-red-500 mt-1">Wachtwoorden komen niet overeen</p>
              )}
            </div>
          )}
          {saveMutation.isError && (
            <p className="text-xs text-red-500">
              {(saveMutation.error as Error).message}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={!canSave || saveMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50"
            >
              {saveMutation.isPending
                ? <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                : <Check size={14} />}
              Opslaan
            </button>
            <button
              onClick={() => setFormOpen(false)}
              className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              Annuleer
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export function LeverancierDetailPage() {
  const { id } = useParams()
  const leverancierId = id ? Number(id) : undefined
  const { data: leverancier, isLoading } = useLeverancierDetail(leverancierId)
  const [editOpen, setEditOpen] = useState(false)

  // Portal token (for the old direct-link button — kept as backup)
  const { data: tokenData } = useQuery({
    queryKey: ['leverancier-portal-token', leverancierId],
    queryFn: () => fetchLeverancierPortalToken(leverancierId!),
    enabled: leverancierId !== undefined,
    staleTime: Infinity,
  })
  const [tokenCopied, setTokenCopied] = useState(false)

  if (isLoading) {
    return <div className="p-12 text-center text-slate-400">Leverancier laden…</div>
  }
  if (!leverancier) {
    return <div className="p-12 text-center text-slate-400">Leverancier niet gevonden</div>
  }

  async function copyTokenLink() {
    if (!tokenData?.portal_token) return
    const directUrl = PORTAL_HTML_BASE
      ? `${PORTAL_HTML_BASE}/index.html?token=${tokenData.portal_token}`
      : `#portal-url-not-configured?token=${tokenData.portal_token}`
    await navigator.clipboard.writeText(directUrl)
    setTokenCopied(true)
    setTimeout(() => setTokenCopied(false), 2000)
  }

  return (
    <>
      <div className="mb-4">
        <Link
          to="/leveranciers"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={14} />
          Leveranciers
        </Link>
      </div>

      <PageHeader
        title={leverancier.naam}
        description={`Leverancier ${leverancier.leverancier_nr ?? '-'}`}
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => setEditOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-[var(--radius-sm)] text-sm font-medium hover:bg-slate-50"
            >
              <Pencil size={16} />
              Bewerken
            </button>
          </div>
        }
      />

      <div className="grid md:grid-cols-2 gap-5 mb-5">
        <section className="bg-white rounded-[var(--radius)] border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={16} className="text-slate-400" />
            <h2 className="font-medium">Gegevens</h2>
          </div>
          <dl className="space-y-2 text-sm">
            <Rij label="Naam" value={leverancier.naam} />
            <Rij label="Woonplaats" value={leverancier.woonplaats} />
            <Rij label="Adres" value={leverancier.adres} />
            <Rij label="Postcode" value={leverancier.postcode} />
            <Rij label="Land" value={leverancier.land} />
            <Rij label="Contact" value={leverancier.contactpersoon} />
            <Rij label="Telefoon" value={leverancier.telefoon} />
            <Rij label="Email" value={leverancier.email} />
            <Rij label="Betaalconditie" value={leverancier.betaalconditie} />
            <Rij label="Status" value={leverancier.actief ? 'Actief' : 'Inactief'} />
          </dl>

          {/* Direct token-link als fallback (verborgen als email/pw al ingesteld) */}
          {tokenData?.portal_token && !leverancier.portal_email && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <button
                onClick={copyTokenLink}
                className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600"
              >
                {tokenCopied ? <Check size={13} className="text-green-500" /> : <ClipboardCopy size={13} />}
                {tokenCopied ? 'Directe link gekopieerd' : 'Kopieer directe portallink'}
              </button>
            </div>
          )}
        </section>

        {leverancierId !== undefined && <LeverancierStatsCard leverancierId={leverancierId} />}
      </div>

      {/* Portal toegang */}
      {leverancierId !== undefined && (
        <div className="mb-5">
          <PortalToegang
            leverancierId={leverancierId}
            leverancierNaam={leverancier.naam}
            portalEmail={leverancier.portal_email ?? null}
          />
        </div>
      )}

      {/* Open inkoopregels met ETA-beheer */}
      {leverancierId !== undefined && (
        <section className="bg-white rounded-[var(--radius)] border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <PackageSearch size={16} className="text-slate-400" />
            <h2 className="font-medium">Open inkoopregels</h2>
          </div>
          <LeverancierOpenRegels leverancierId={leverancierId} />
        </section>
      )}

      {editOpen && (
        <LeverancierFormDialog leverancier={leverancier} onClose={() => setEditOpen(false)} />
      )}
    </>
  )
}

function Rij({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-4">
      <dt className="w-32 text-slate-500">{label}</dt>
      <dd className="flex-1 text-slate-800">{value || <span className="text-slate-400">-</span>}</dd>
    </div>
  )
}
