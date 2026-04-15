/** Order status → badge color mapping */
export const ORDER_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'Nieuw': { bg: 'bg-blue-100', text: 'text-blue-700' },
  'Actie vereist': { bg: 'bg-rose-100', text: 'text-rose-700' },
  'Wacht op picken': { bg: 'bg-amber-100', text: 'text-amber-700' },
  'Wacht op voorraad': { bg: 'bg-amber-100', text: 'text-amber-700' },
  'In snijplan': { bg: 'bg-purple-100', text: 'text-purple-700' },
  'In productie': { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  'Deels gereed': { bg: 'bg-cyan-100', text: 'text-cyan-700' },
  'Klaar voor verzending': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'Verzonden': { bg: 'bg-green-100', text: 'text-green-700' },
  'Geannuleerd': { bg: 'bg-gray-100', text: 'text-gray-500' },
}

/** Tier badge colors */
export const TIER_COLORS: Record<string, { bg: string; text: string }> = {
  'Gold': { bg: 'bg-amber-100', text: 'text-amber-700' },
  'Silver': { bg: 'bg-slate-200', text: 'text-slate-700' },
  'Bronze': { bg: 'bg-orange-100', text: 'text-orange-700' },
}

/** Snijplan status → badge color mapping */
export const SNIJPLAN_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'Snijden': { bg: 'bg-blue-100', text: 'text-blue-700' },
  'Gesneden': { bg: 'bg-amber-100', text: 'text-amber-700' },
  'In confectie': { bg: 'bg-purple-100', text: 'text-purple-700' },
  'Gereed': { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  'Ingepakt': { bg: 'bg-teal-100', text: 'text-teal-700' },
  'Geannuleerd': { bg: 'bg-gray-100', text: 'text-gray-500' },
}

/** Confectie status → badge color mapping */
export const CONFECTIE_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
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
  { code: 'ZO', label: 'Zonder afwerking', bg: 'bg-gray-100',    text: 'text-gray-500' },
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
      { label: 'Magazijn', path: '/magazijn', icon: 'Warehouse' },
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
    label: 'Systeem',
    items: [
      { label: 'Instellingen', path: '/instellingen', icon: 'Settings' },
    ],
  },
] as const
