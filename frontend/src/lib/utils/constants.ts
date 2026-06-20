import type { SnijplanStatus, ConfectieStatus } from '@/lib/utils/snijplan-status'

/** Order status → badge color mapping
 *  Canonieke statussen na ADR-0016 (mig 257-258). Legacy waarden behouden
 *  voor backwards-compat met historische orders. */
export const ORDER_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  // Concept — e-mail order wachtend op review
  'Concept':               { bg: 'bg-amber-100',   text: 'text-amber-700' },
  // Canoniek (ADR-0016)
  'Klaar voor picken':     { bg: 'bg-blue-100',    text: 'text-blue-700' },
  'Wacht op voorraad':     { bg: 'bg-amber-100',   text: 'text-amber-700' },
  'Wacht op inkoop':       { bg: 'bg-orange-100',  text: 'text-orange-700' },
  'Wacht op maatwerk':     { bg: 'bg-purple-100',  text: 'text-purple-700' },
  'In pickronde':          { bg: 'bg-indigo-100',  text: 'text-indigo-700' },
  'Deels verzonden':       { bg: 'bg-cyan-100',    text: 'text-cyan-700' },
  'Verzonden':             { bg: 'bg-green-100',   text: 'text-green-700' },
  'Geannuleerd':           { bg: 'bg-gray-100',    text: 'text-gray-500' },
  // Terminaal voor productie-only orders (ADR-0029, mig 327/330)
  'Maatwerk afgerond':     { bg: 'bg-teal-100',    text: 'text-teal-700' },
  // Legacy — niet meer geschreven post-mig-258, maar bestaande data kan ze nog hebben
  'Nieuw':                 { bg: 'bg-blue-100',    text: 'text-blue-700' },
  'Actie vereist':         { bg: 'bg-rose-100',    text: 'text-rose-700' },
  'Wacht op picken':       { bg: 'bg-amber-100',   text: 'text-amber-700' },
  'In snijplan':           { bg: 'bg-purple-100',  text: 'text-purple-700' },
  'In productie':          { bg: 'bg-indigo-100',  text: 'text-indigo-700' },
  'Deels gereed':          { bg: 'bg-cyan-100',    text: 'text-cyan-700' },
  'Klaar voor verzending': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
}

/** Tier badge colors */
export const TIER_COLORS: Record<string, { bg: string; text: string }> = {
  'Gold': { bg: 'bg-amber-100', text: 'text-amber-700' },
  'Silver': { bg: 'bg-slate-200', text: 'text-slate-700' },
  'Bronze': { bg: 'bg-orange-100', text: 'text-orange-700' },
}

/** Snijplan status → badge color mapping (compiler dwingt alle 9 af) */
export const SNIJPLAN_STATUS_COLORS: Record<SnijplanStatus, { bg: string; text: string }> = {
  'Wacht': { bg: 'bg-slate-100', text: 'text-slate-600' },
  'Gepland': { bg: 'bg-slate-100', text: 'text-slate-700' },
  'In productie': { bg: 'bg-amber-100', text: 'text-amber-700' },
  'Snijden': { bg: 'bg-blue-100', text: 'text-blue-700' },
  'Gesneden': { bg: 'bg-amber-100', text: 'text-amber-700' },
  'In confectie': { bg: 'bg-purple-100', text: 'text-purple-700' },
  'Gereed': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'Ingepakt': { bg: 'bg-teal-100', text: 'text-teal-700' },
  'Geannuleerd': { bg: 'bg-gray-100', text: 'text-gray-500' },
}

/** Gecombineerde tailwind-className voor een snijplan-status-badge. */
export function snijplanBadgeClass(status: string): string {
  const c = (SNIJPLAN_STATUS_COLORS as Record<string, { bg: string; text: string }>)[status]
  return c ? `${c.bg} ${c.text}` : 'bg-gray-100 text-gray-600'
}

/** Confectie status → badge color mapping (compiler dwingt alle 5 af) */
export const CONFECTIE_STATUS_COLORS: Record<ConfectieStatus, { bg: string; text: string }> = {
  'Wacht op materiaal': { bg: 'bg-amber-100', text: 'text-amber-700' },
  'In productie': { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  'Kwaliteitscontrole': { bg: 'bg-purple-100', text: 'text-purple-700' },
  'Gereed': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'Geannuleerd': { bg: 'bg-gray-100', text: 'text-gray-500' },
}

/** Afwerking code → label + badge color mapping */
export const AFWERKING_OPTIES: { code: string; label: string; bg: string; text: string }[] = [
  { code: 'B',  label: 'Breedband',        bg: 'bg-purple-100',  text: 'text-purple-700' },
  { code: 'FE', label: 'Feston',           bg: 'bg-blue-100',    text: 'text-blue-700' },
  { code: 'LO', label: 'Locken',           bg: 'bg-cyan-100',    text: 'text-cyan-700' },
  { code: 'ON', label: 'Onafgewerkt',      bg: 'bg-slate-100',   text: 'text-slate-600' },
  { code: 'SB', label: 'Smalband',         bg: 'bg-indigo-100',  text: 'text-indigo-700' },
  { code: 'SF', label: 'Smalfeston',       bg: 'bg-teal-100',    text: 'text-teal-700' },
  { code: 'VO', label: 'Volume afwerking', bg: 'bg-amber-100',   text: 'text-amber-700' },
  { code: 'ZO', label: 'Zoomlock',          bg: 'bg-gray-100',    text: 'text-gray-500' },
  { code: 'FUR', label: 'Fur',             bg: 'bg-pink-100',    text: 'text-pink-700' },
]

export const AFWERKING_MAP = Object.fromEntries(
  AFWERKING_OPTIES.map((a) => [a.code, a])
) as Record<string, (typeof AFWERKING_OPTIES)[number]>

/** Rol status → badge color mapping */
export const ROL_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'beschikbaar': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'gereserveerd': { bg: 'bg-blue-100', text: 'text-blue-700' },
  'in_snijplan': { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  'gesneden': { bg: 'bg-amber-100', text: 'text-amber-700' },
  'reststuk': { bg: 'bg-orange-100', text: 'text-orange-700' },
  'verkocht': { bg: 'bg-gray-100', text: 'text-gray-500' },
}

export const ROL_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  'volle_rol': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'aangebroken': { bg: 'bg-blue-100', text: 'text-blue-700' },
  'reststuk': { bg: 'bg-red-100', text: 'text-red-700' },
}

export const ROL_TYPE_LABELS: Record<string, string> = {
  'volle_rol': 'VOLLE ROL',
  'aangebroken': 'AANGEBROKEN',
  'reststuk': 'RESTSTUK',
}

/** Factuur status → badge color mapping */
export const FACTUUR_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'Concept':      { bg: 'bg-slate-100',   text: 'text-slate-700' },
  'Verstuurd':    { bg: 'bg-blue-100',    text: 'text-blue-700' },
  'Betaald':      { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'Herinnering':  { bg: 'bg-amber-100',   text: 'text-amber-700' },
  'Aanmaning':    { bg: 'bg-rose-100',    text: 'text-rose-700' },
  'Gecrediteerd': { bg: 'bg-gray-100',    text: 'text-gray-500' },
}

/** Sidebar navigation structure */
export const NAV_GROUPS = [
  {
    label: 'Overzicht',
    items: [
      { label: 'Dashboard', path: '/', icon: 'LayoutDashboard' },
    ],
  },
  {
    label: 'Commercieel',
    items: [
      { label: 'Orders', path: '/orders', icon: 'ShoppingCart' },
      { label: 'Samples', path: '/samples', icon: 'Package' },
      { label: 'Facturatie', path: '/facturatie', icon: 'FileText' },
      { label: 'Klanten', path: '/klanten', icon: 'Users' },
      { label: 'Inkoopgroepen', path: '/inkoopgroepen', icon: 'Network' },
      { label: 'Vertegenwoordigers', path: '/vertegenwoordigers', icon: 'UserCheck' },
      { label: 'Prijslijsten', path: '/prijslijsten', icon: 'ListOrdered' },
    ],
  },
  {
    label: 'Producten & Voorraad',
    items: [
      { label: 'Producten', path: '/producten', icon: 'Grid3X3' },
      { label: 'Rollen & Reststukken', path: '/rollen', icon: 'Cylinder' },
      { label: 'Scanstation', path: '/scanstation', icon: 'ScanBarcode' },
    ],
  },
  {
    label: 'Operationeel',
    items: [
      { label: 'Snijplanning', path: '/snijplanning', icon: 'Scissors' },
      { label: 'Confectie', path: '/confectie', icon: 'Factory' },
      { label: 'Pick & Ship', path: '/pick-ship', icon: 'PackageCheck' },
      { label: 'Logistiek', path: '/logistiek', icon: 'Truck' },
    ],
  },
  {
    label: 'Inkoop',
    items: [
      { label: 'Inkooporders', path: '/inkoop', icon: 'ClipboardList' },
      { label: 'Leveranciers', path: '/leveranciers', icon: 'Building2' },
    ],
  },
  {
    label: 'EDI',
    items: [
      { label: 'Berichten', path: '/edi/berichten', icon: 'Mail' },
      { label: 'Handelspartners', path: '/edi/partners', icon: 'Building2' },
    ],
  },
  {
    label: 'Systeem',
    items: [
      { label: 'Instellingen', path: '/instellingen', icon: 'Settings' },
      { label: 'Bedrijfsgegevens', path: '/instellingen/bedrijfsgegevens', icon: 'Building2' },
      { label: 'Kwaliteiten', path: '/instellingen/kwaliteiten', icon: 'Scale' },
      { label: 'Vormen', path: '/instellingen/vormen', icon: 'Shapes' },
      { label: 'Afwerkingen', path: '/instellingen/afwerkingen', icon: 'Scissors' },
      { label: 'Betaalcondities', path: '/instellingen/betaalcondities', icon: 'Receipt' },
      { label: 'Medewerkers', path: '/instellingen/medewerkers', icon: 'Users' },
      { label: 'Gebruikers', path: '/instellingen/gebruikers', icon: 'UserPlus' },
    ],
  },
] as const
