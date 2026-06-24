import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { iso2NaarNaam, iso2NaarVlag } from '@/lib/utils/land-vlag'
import {
  useAlleVerzendregels,
  useDeleteVerzendregel,
  useUpdateVerzendregel,
} from '@/modules/logistiek/hooks/use-verzendregels'
import { useAuth } from '@/hooks/use-auth'
import type { Verzendregel } from '@/modules/logistiek/queries/verzendregels'
import type { Vervoerder } from '@/modules/logistiek/queries/vervoerders'
import { VerzendregelDialog } from './verzendregel-dialog'

interface Props {
  vervoerders: Vervoerder[]
}

const ALGEMEEN_KEY = '__alle_landen__'

interface RegelGroep {
  /** ISO-2 of ALGEMEEN_KEY */
  key: string
  iso2: string | null
  vlag: string | null
  naam: string
  regels: Verzendregel[]
}

/**
 * Centrale beheer-sectie voor verzendregels — land-eerst weergave.
 *
 * Regels worden per land gegroepeerd: een regel met `conditie.land=['NL','BE']`
 * verschijnt onder zowel NL als BE. Regels zonder `land`-conditie vallen onder
 * "Algemeen (alle landen)". Binnen een groep sorteren we op prio ASC, id ASC —
 * dezelfde volgorde als de DB-evaluator (mig 210) toepast.
 */
export function VerzendregelsSectie({ vervoerders }: Props) {
  // Externe vertegenwoordiger (mig 489): read-only — regels alleen lezen.
  const { isExternRep } = useAuth()
  const { data: regels = [], isLoading } = useAlleVerzendregels()
  const deleteMut = useDeleteVerzendregel()
  const updateMut = useUpdateVerzendregel()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Verzendregel | null>(null)
  const [prefillLand, setPrefillLand] = useState<string | null>(null)

  const [landToevoegOpen, setLandToevoegOpen] = useState(false)
  const [nieuwLandInput, setNieuwLandInput] = useState('')

  const vervoerderMap = useMemo(
    () => new Map(vervoerders.map((v) => [v.code, v])),
    [vervoerders],
  )

  const groepen = useMemo<RegelGroep[]>(() => groepeerOpLand(regels), [regels])
  const algemeneGroep = groepen.find((g) => g.key === ALGEMEEN_KEY) ?? null
  const landGroepen = groepen.filter((g) => g.key !== ALGEMEEN_KEY)

  function openAdd(landIso2: string | null) {
    setEditTarget(null)
    setPrefillLand(landIso2)
    setDialogOpen(true)
  }

  function openEdit(regel: Verzendregel) {
    setEditTarget(regel)
    setPrefillLand(null)
    setDialogOpen(true)
  }

  function handleToggle(regel: Verzendregel) {
    updateMut.mutate({ id: regel.id, patch: { actief: !regel.actief } })
  }

  function handleDelete(regel: Verzendregel) {
    if (!confirm(`Verzendregel #${regel.id} (prio ${regel.prio}) verwijderen?`)) return
    deleteMut.mutate({ id: regel.id })
  }

  function handleLandToevoegen() {
    const iso2 = nieuwLandInput.trim().toUpperCase()
    if (iso2.length !== 2 || !/^[A-Z]{2}$/.test(iso2)) {
      alert('Voer een 2-letter ISO-landcode in (bv. NL, BE, DE).')
      return
    }
    setLandToevoegOpen(false)
    setNieuwLandInput('')
    openAdd(iso2)
  }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5 mt-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Verzendregels per land</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Welke vervoerder leveren we naar welk land. Specifiekere regels (met afmeting/
            gewicht) staan boven generieke.
          </p>
        </div>
        {!isExternRep && (
          <div className="flex items-center gap-2">
            {landToevoegOpen ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  type="text"
                  maxLength={2}
                  value={nieuwLandInput}
                  onChange={(e) => setNieuwLandInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleLandToevoegen()
                    if (e.key === 'Escape') {
                      setLandToevoegOpen(false)
                      setNieuwLandInput('')
                    }
                  }}
                  placeholder="NL"
                  className="w-16 px-2 py-1 rounded-[var(--radius-sm)] border border-slate-300 text-sm uppercase font-mono focus:outline-none focus:ring-2 focus:ring-terracotta-400/30"
                />
                <button
                  type="button"
                  onClick={handleLandToevoegen}
                  className="px-2.5 py-1 rounded-[var(--radius-sm)] text-xs font-medium bg-terracotta-600 text-white hover:bg-terracotta-700"
                >
                  OK
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLandToevoegOpen(false)
                    setNieuwLandInput('')
                  }}
                  className="px-2.5 py-1 rounded-[var(--radius-sm)] text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Annuleer
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLandToevoegOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <Plus size={14} /> Land toevoegen
              </button>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="text-xs text-slate-400 py-4">Laden…</div>
      ) : regels.length === 0 ? (
        <div className="text-xs text-slate-400 py-6 italic text-center">
          Nog geen verzendregels. Klik "Land toevoegen" om te beginnen.
        </div>
      ) : (
        <div className="space-y-4">
          {landGroepen.map((g) => (
            <LandBlok
              key={g.key}
              groep={g}
              vervoerderMap={vervoerderMap}
              updateBusy={updateMut.isPending}
              readOnly={isExternRep}
              onAdd={() => openAdd(g.iso2)}
              onEdit={openEdit}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))}

          {algemeneGroep && (
            <LandBlok
              groep={algemeneGroep}
              vervoerderMap={vervoerderMap}
              updateBusy={updateMut.isPending}
              readOnly={isExternRep}
              onAdd={() => openAdd(null)}
              onEdit={openEdit}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          )}

          {!algemeneGroep && !isExternRep && (
            <button
              type="button"
              onClick={() => openAdd(null)}
              className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-[var(--radius-sm)] text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 border border-dashed border-slate-200"
            >
              <Plus size={13} /> Algemene regel (geldt voor alle landen)
            </button>
          )}
        </div>
      )}

      {!isExternRep && (
        <VerzendregelDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          vervoerders={vervoerders}
          target={editTarget}
          prefillLand={prefillLand}
        />
      )}
    </div>
  )
}

interface LandBlokProps {
  groep: RegelGroep
  vervoerderMap: Map<string, Vervoerder>
  updateBusy: boolean
  readOnly: boolean
  onAdd: () => void
  onEdit: (r: Verzendregel) => void
  onToggle: (r: Verzendregel) => void
  onDelete: (r: Verzendregel) => void
}

function LandBlok({
  groep,
  vervoerderMap,
  updateBusy,
  readOnly,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
}: LandBlokProps) {
  const isAlgemeen = groep.key === ALGEMEEN_KEY

  return (
    <div className="border border-slate-200 rounded-[var(--radius-sm)] overflow-hidden">
      <div
        className={`flex items-center justify-between px-4 py-2.5 ${
          isAlgemeen ? 'bg-slate-50' : 'bg-white border-b border-slate-100'
        }`}
      >
        <div className="flex items-center gap-2.5">
          {groep.vlag && <span className="text-lg leading-none">{groep.vlag}</span>}
          <div>
            <div className="text-sm font-semibold text-slate-800">{groep.naam}</div>
            {groep.iso2 && (
              <div className="text-[11px] text-slate-400 font-mono">{groep.iso2}</div>
            )}
          </div>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1 text-xs text-terracotta-600 hover:text-terracotta-700 font-medium"
          >
            <Plus size={12} /> Regel
          </button>
        )}
      </div>

      <ul className="divide-y divide-slate-100">
        {groep.regels.map((r) => (
          <li
            key={r.id}
            className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50/60"
          >
            <div className="flex-1 min-w-0">
              <RegelOmschrijving regel={r} vervoerderMap={vervoerderMap} />
              {r.notitie && (
                <div className="text-[11px] text-slate-400 italic mt-0.5">{r.notitie}</div>
              )}
            </div>
            {!readOnly && (
              <div className="flex items-center gap-1.5 ml-3 shrink-0">
                <Toggle
                  checked={r.actief}
                  disabled={updateBusy}
                  onChange={() => onToggle(r)}
                />
                <button
                  type="button"
                  onClick={() => onEdit(r)}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Bewerk"
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(r)}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                  aria-label="Verwijder"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function RegelOmschrijving({
  regel,
  vervoerderMap,
}: {
  regel: Verzendregel
  vervoerderMap: Map<string, Vervoerder>
}) {
  const v = vervoerderMap.get(regel.vervoerder_code)
  const vDisplay = v?.display_naam ?? regel.vervoerder_code
  const filterTekst = bouwFilterTekst(regel.conditie)

  return (
    <div className="flex items-baseline flex-wrap gap-x-2 gap-y-0.5 text-sm">
      {filterTekst && (
        <span className="text-slate-600">
          <span className="text-slate-400">als</span> {filterTekst}
        </span>
      )}
      <span className="text-slate-400">→</span>
      <span className="font-semibold text-slate-800">{vDisplay}</span>
      {regel.service_code && (
        <span className="text-xs text-slate-500">({regel.service_code})</span>
      )}
      {!regel.actief && (
        <span className="text-[10px] uppercase tracking-wide text-amber-600 ml-1">
          inactief
        </span>
      )}
    </div>
  )
}

function bouwFilterTekst(c: Verzendregel['conditie']): string | null {
  const delen: string[] = []

  // Multi-land regel: laat de andere landen zien onder een land-blok ("ook BE, DE")
  // — dit is een visuele hint, geen logica-verandering.
  if (c.land && c.land.length > 1) {
    delen.push(`landen ${c.land.join(', ')}`)
  }

  if (c.gewicht_kg_min != null && c.gewicht_kg_max != null) {
    delen.push(`gewicht ${c.gewicht_kg_min}–${c.gewicht_kg_max} kg`)
  } else if (c.gewicht_kg_min != null) {
    delen.push(`gewicht ≥ ${c.gewicht_kg_min} kg`)
  } else if (c.gewicht_kg_max != null) {
    delen.push(`gewicht ≤ ${c.gewicht_kg_max} kg`)
  }

  if (c.kleinste_zijde_cm_min != null && c.kleinste_zijde_cm_max != null) {
    delen.push(`rol-lengte ${c.kleinste_zijde_cm_min}–${c.kleinste_zijde_cm_max} cm`)
  } else if (c.kleinste_zijde_cm_min != null) {
    delen.push(`rol-lengte ≥ ${c.kleinste_zijde_cm_min} cm`)
  } else if (c.kleinste_zijde_cm_max != null) {
    delen.push(`rol-lengte ≤ ${c.kleinste_zijde_cm_max} cm`)
  }

  if (c.inkoopgroep_codes?.length) {
    delen.push(`inkoopgroep ${c.inkoopgroep_codes.join(', ')}`)
  }
  if (c.debiteur_nrs?.length) {
    delen.push(`debiteur ${c.debiteur_nrs.join(', ')}`)
  }

  return delen.length > 0 ? delen.join(' · ') : null
}

function groepeerOpLand(regels: Verzendregel[]): RegelGroep[] {
  // Vaste volgorde voor de meest gebruikte landen — andere landen komen
  // alfabetisch erachter, daarna "Algemeen" als laatste.
  const VASTE_VOLGORDE = ['NL', 'BE', 'DE', 'FR', 'LU', 'AT', 'CH']

  const map = new Map<string, Verzendregel[]>()

  for (const r of regels) {
    const landen = r.conditie.land ?? []
    if (landen.length === 0) {
      pushNaarKey(map, ALGEMEEN_KEY, r)
    } else {
      for (const iso of landen) {
        pushNaarKey(map, iso.toUpperCase(), r)
      }
    }
  }

  const keys = Array.from(map.keys())
  const landKeys = keys.filter((k) => k !== ALGEMEEN_KEY)

  landKeys.sort((a, b) => {
    const ai = VASTE_VOLGORDE.indexOf(a)
    const bi = VASTE_VOLGORDE.indexOf(b)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
  })

  const out: RegelGroep[] = landKeys.map((k) => ({
    key: k,
    iso2: k,
    vlag: iso2NaarVlag(k),
    naam: iso2NaarNaam(k) ?? k,
    regels: (map.get(k) ?? []).slice().sort(sorteerRegels),
  }))

  if (map.has(ALGEMEEN_KEY)) {
    out.push({
      key: ALGEMEEN_KEY,
      iso2: null,
      vlag: null,
      naam: 'Algemeen (alle landen)',
      regels: (map.get(ALGEMEEN_KEY) ?? []).slice().sort(sorteerRegels),
    })
  }

  return out
}

function pushNaarKey(map: Map<string, Verzendregel[]>, key: string, r: Verzendregel) {
  const arr = map.get(key)
  if (arr) arr.push(r)
  else map.set(key, [r])
}

function sorteerRegels(a: Verzendregel, b: Verzendregel): number {
  if (a.prio !== b.prio) return a.prio - b.prio
  return a.id - b.id
}

interface ToggleProps {
  checked: boolean
  onChange: () => void
  disabled?: boolean
}

function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 disabled:opacity-50 ${
        checked ? 'bg-terracotta-500' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-3.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
