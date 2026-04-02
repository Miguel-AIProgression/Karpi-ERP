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
    label: 'Systeem',
    items: [
      { label: 'Instellingen', path: '/instellingen', icon: 'Settings' },
    ],
  },
] as const
