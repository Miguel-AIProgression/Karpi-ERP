// Public surface van de orders-module.
//
// Externe consumers (router, sidebar, klanten-module) importeren bij voorkeur
// via deze barrel; interne imports binnen de module mogen direct verwijzen
// naar sub-folders.

// Pages
export { OrdersOverviewPage } from './pages/orders-overview'
export { OrderDetailPage } from './pages/order-detail'
export { OrderCreatePage } from './pages/order-create'
export { OrderEditPage } from './pages/order-edit'

// Hooks
export {
  useOrders,
  useStatusCounts,
  useOrderDetail,
  useOrderRegels,
  useOrder,
} from './hooks/use-orders'
export {
  useLevertijdVoorOrder,
  useClaimsVoorOrder,
  useOrderClaims,
  useClaimsVoorOrderRegel,
  useClaimsVoorIORegel,
} from './hooks/use-reserveringen'
export {
  useDocumenten,
  useUploadDocument,
  useDeleteDocument,
  useUpdateDocumentOmschrijving,
} from './hooks/use-documenten'
export {
  useLevertijdCheck,
  type UseLevertijdCheckArgs,
} from './hooks/use-levertijd-check'

// Queries — types
export type {
  OrderRow,
  OrderDetail,
  OrderRegel,
  OrderRegelSnijplan,
  StatusCount,
  OrderSortField,
  SortDirection,
} from './queries/orders'
export type {
  OrderFormData,
  OrderRegelFormData,
} from './queries/order-mutations'
export type {
  OrderRegelLevertijd,
  LevertijdStatus,
} from './queries/reserveringen'

// Components
export { RegelClaimDetail } from './components/regel-claim-detail'

// Lib
export {
  berekenPrijsOppervlakM2,
  berekenMaatwerkPrijs,
  berekenMaatwerkGewicht,
} from './lib/maatwerk-prijs'
