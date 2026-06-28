import { createBrowserRouter, Navigate } from 'react-router-dom'
import { PaginaGuard } from '@/components/auth/pagina-guard'
import { AppLayout } from '@/components/layout/app-layout'
import { DashboardPage } from '@/pages/dashboard'
import { PlaceholderPage } from '@/pages/placeholder'
import { OrdersOverviewPage } from '@/pages/orders/orders-overview'
import { OrderDetailPage } from '@/pages/orders/order-detail'
import { OrderCreatePage } from '@/pages/orders/order-create'
import { OrderEditPage } from '@/pages/orders/order-edit'
import { DebiteurenOverviewPage, DebiteurDetailPage } from '@/modules/debiteuren'
import { InkoopgroepenOverviewPage } from '@/pages/inkoopgroepen/inkoopgroepen-overview'
import { InkoopgroepDetailPage } from '@/pages/inkoopgroepen/inkoopgroep-detail'
import { ProductenOverviewPage } from '@/pages/producten/producten-overview'
import { ProductDetailPage } from '@/pages/producten/product-detail'
import { ProductCreatePage } from '@/pages/producten/product-create'
import { ProductEditPage } from '@/pages/producten/product-edit'
import { BackordersPage } from '@/pages/producten/backorders-page'
import { VertegenwoordigersOverviewPage } from '@/pages/vertegenwoordigers/vertegenwoordigers-overview'
import { VertegenwoordigerDetailPage } from '@/pages/vertegenwoordigers/vertegenwoordiger-detail'
import { PrijslijstenOverviewPage } from '@/pages/prijslijsten/prijslijsten-overview'
import { PrijslijstDetailPage } from '@/pages/prijslijsten/prijslijst-detail'
import { SnijplanningOverviewPage } from '@/pages/snijplanning/snijplanning-overview'
import { WerklijstPage } from '@/pages/snijplanning/werklijst-page'
import { HaalbaarheidOverviewPage } from '@/pages/snijplanning/haalbaarheid-overview'
import { MasterPlanningPage } from '@/pages/snijplanning/master-planning-overview'
import { RolSnijvoorstelPage } from '@/pages/snijplanning/rol-snijvoorstel'
import { StickerPrintPage } from '@/pages/snijplanning/sticker-print'
import { StickersBulkPage } from '@/pages/snijplanning/stickers-bulk'
import { SnijvoorstelReviewPage } from '@/pages/snijplanning/snijvoorstel-review'
import { ProductieRolPage } from '@/pages/snijplanning/productie-rol'
import { ProductieGroepPage } from '@/pages/snijplanning/productie-groep'
import { ProductieInstellingenPage } from '@/pages/instellingen/productie-instellingen'
import { BedrijfsgegevensPage } from '@/pages/instellingen/bedrijfsgegevens'
import { KwaliteitenInstellingenPage } from '@/pages/instellingen/kwaliteiten'
import { VormenInstellingenPage, AfwerkingenInstellingenPage } from '@/modules/maatwerk'
import { BetaalconditiesInstellingenPage } from '@/pages/instellingen/betaalcondities'
import { MedewerkersInstellingenPage } from '@/pages/instellingen/medewerkers'
import { GebruikersInstellingenPage } from '@/pages/instellingen/gebruikers'
import { WachtwoordInstellenPage } from '@/pages/wachtwoord-instellen'
import { ConfectieOverviewPage } from '@/pages/confectie/confectie-overview'
import { ConfectiePlanningPage } from '@/pages/confectie/confectie-planning'
import { ScanstationPage } from '@/pages/scanstation/scanstation'
import { RollenOverviewPage } from '@/pages/rollen/rollen-overview'
import { MagazijnOverviewPage } from '@/modules/magazijn'
import { FacturatieOverviewPage, FactuurDetailPage } from '@/modules/facturatie'
import { InkooporderOverviewPage } from '@/modules/inkoop/pages/inkooporders-overview'
import { InkooporderDetailPage } from '@/modules/inkoop/pages/inkooporder-detail'
import { RolStickersPrintPage } from '@/modules/inkoop/pages/rol-stickers-print'
import { LeveranciersOverviewPage } from '@/modules/inkoop/pages/leveranciers-overview'
import { LeverancierDetailPage } from '@/modules/inkoop/pages/leverancier-detail'
import { EdiBerichtenOverzichtPage } from '@/modules/edi/pages/berichten-overzicht'
import { EdiBerichtDetailPage } from '@/modules/edi/pages/bericht-detail'
import { EdiPartnersOverzichtPage } from '@/modules/edi/pages/partners-overzicht'
import {
  ZendingenOverzichtPage,
  ZendingDetailPage,
  ZendingPrintSetPage,
  BulkPrintSetPage,
  VervoerdersOverzichtPage,
  VervoerderDetailPage,
} from '@/modules/logistiek'
import { SupplierPortalPage } from '@/pages/portal/supplier-portal'
import { PortalLoginPage } from '@/pages/portal/portal-login'
import { BugMeldingenPage } from '@/pages/feedback/bug-meldingen'

export const router = createBrowserRouter([
  // Standalone (zonder app-shell): publieke pagina's zonder auth
  { path: 'wachtwoord-instellen', element: <WachtwoordInstellenPage /> },
  { path: 'portal/login', element: <PortalLoginPage /> },
  { path: 'portal/:token', element: <SupplierPortalPage /> },
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },

      // Feedback / bug-meldingen (bereikbaar via gebruikersmenu rechtsboven)
      { path: 'meldingen', element: <BugMeldingenPage /> },

      // Orders (V1)
      { path: 'orders', element: <OrdersOverviewPage /> },
      { path: 'orders/nieuw', element: <OrderCreatePage /> },
      { path: 'orders/:id', element: <OrderDetailPage /> },
      { path: 'orders/:id/bewerken', element: <OrderEditPage /> },

      // Klanten (V1) — Debiteur-Module per ADR-0011 (folder DB-aligned, route blijft 'klanten')
      { path: 'klanten', element: <DebiteurenOverviewPage /> },
      { path: 'klanten/:id', element: <DebiteurDetailPage /> },

      // Inkoopgroepen
      { path: 'inkoopgroepen', element: <InkoopgroepenOverviewPage /> },
      { path: 'inkoopgroepen/:code', element: <InkoopgroepDetailPage /> },

      // Producten (V1)
      { path: 'producten', element: <ProductenOverviewPage /> },
      { path: 'producten/nieuw', element: <ProductCreatePage /> },
      { path: 'producten/:id', element: <ProductDetailPage /> },
      { path: 'producten/:id/bewerken', element: <ProductEditPage /> },
      { path: 'backorders', element: <BackordersPage /> },

      // Prijslijsten
      { path: 'prijslijsten', element: <PrijslijstenOverviewPage /> },
      { path: 'prijslijsten/:nr', element: <PrijslijstDetailPage /> },

      // Placeholders (V2+)
      { path: 'samples', element: <PlaceholderPage title="Samples" /> },
      { path: 'facturatie', element: <FacturatieOverviewPage /> },
      { path: 'facturatie/:id', element: <FactuurDetailPage /> },
      { path: 'vertegenwoordigers', element: <VertegenwoordigersOverviewPage /> },
      { path: 'vertegenwoordigers/:code', element: <VertegenwoordigerDetailPage /> },
      { path: 'rollen', element: <RollenOverviewPage /> },
      { path: 'rollen/stickers', element: <RolStickersPrintPage /> },
      { path: 'scanstation', element: <ScanstationPage /> },
      { path: 'magazijn', element: <Navigate to="/pick-ship" replace /> },
      { path: 'snijplanning', element: <SnijplanningOverviewPage /> },
      { path: 'snijplanning/werklijst', element: <WerklijstPage /> },
      { path: 'snijplanning/haalbaarheid', element: <HaalbaarheidOverviewPage /> },
      { path: 'snijplanning/master-planning', element: <MasterPlanningPage /> },
      { path: 'snijplanning/rol/:rolId', element: <RolSnijvoorstelPage /> },
      { path: 'snijplanning/voorstel/:voorstelId', element: <SnijvoorstelReviewPage /> },
      { path: 'snijplanning/:id/stickers', element: <StickerPrintPage /> },
      { path: 'snijplanning/stickers', element: <StickersBulkPage /> },
      { path: 'snijplanning/productie', element: <ProductieGroepPage /> },
      { path: 'snijplanning/productie/:rolId', element: <ProductieRolPage /> },
      { path: 'confectie', element: <ConfectieOverviewPage /> },
      { path: 'confectie/planning', element: <ConfectiePlanningPage /> },
      { path: 'pick-ship', element: <MagazijnOverviewPage /> },
      { path: 'logistiek', element: <ZendingenOverzichtPage /> },
      // Belangrijk: vervoerders-routes en de bulk-printset-route vóór `:zending_nr`
      // om matching-conflict te vermijden (anders gaat 'printset' / 'bulk' / 'vervoerders'
      // als zending_nr de detail-route in).
      { path: 'logistiek/vervoerders', element: <VervoerdersOverzichtPage /> },
      { path: 'logistiek/vervoerders/:code', element: <VervoerderDetailPage /> },
      { path: 'logistiek/vervoerders/:code/monitor', element: <VervoerderDetailPage /> },
      // Oude monitor-URL (was eigen menu-item) → tab op de HST-vervoerderpagina
      { path: 'logistiek/hst-monitor', element: <Navigate to="/logistiek/vervoerders/hst_api/monitor" replace /> },
      { path: 'logistiek/printset/bulk', element: <BulkPrintSetPage /> },
      { path: 'logistiek/:zending_nr/printset', element: <ZendingPrintSetPage /> },
      { path: 'logistiek/:zending_nr', element: <ZendingDetailPage /> },
      { path: 'inkoop', element: <PaginaGuard><InkooporderOverviewPage /></PaginaGuard> },
      { path: 'inkoop/:id', element: <PaginaGuard><InkooporderDetailPage /></PaginaGuard> },
      { path: 'leveranciers', element: <PaginaGuard><LeveranciersOverviewPage /></PaginaGuard> },
      { path: 'leveranciers/:id', element: <PaginaGuard><LeverancierDetailPage /></PaginaGuard> },

      // EDI / Transus
      { path: 'edi/berichten', element: <EdiBerichtenOverzichtPage /> },
      { path: 'edi/berichten/:id', element: <EdiBerichtDetailPage /> },
      { path: 'edi/partners', element: <EdiPartnersOverzichtPage /> },

      { path: 'instellingen', element: <ProductieInstellingenPage /> },
      { path: 'instellingen/productie', element: <ProductieInstellingenPage /> },
      { path: 'instellingen/bedrijfsgegevens', element: <BedrijfsgegevensPage /> },
      { path: 'instellingen/kwaliteiten', element: <KwaliteitenInstellingenPage /> },
      { path: 'instellingen/vormen', element: <VormenInstellingenPage /> },
      { path: 'instellingen/afwerkingen', element: <AfwerkingenInstellingenPage /> },
      { path: 'instellingen/betaalcondities', element: <BetaalconditiesInstellingenPage /> },
      { path: 'instellingen/medewerkers', element: <MedewerkersInstellingenPage /> },
      { path: 'instellingen/gebruikers', element: <GebruikersInstellingenPage /> },
    ],
  },
])
