import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/app-layout'
import { DashboardPage } from '@/pages/dashboard'
import { PlaceholderPage } from '@/pages/placeholder'
import { OrdersOverviewPage } from '@/modules/orders/pages/orders-overview'
import { OrderDetailPage } from '@/modules/orders/pages/order-detail'
import { OrderCreatePage } from '@/modules/orders/pages/order-create'
import { OrderEditPage } from '@/modules/orders/pages/order-edit'
import { KlantenOverviewPage } from '@/pages/klanten/klanten-overview'
import { KlantDetailPage } from '@/pages/klanten/klant-detail'
import { ProductenOverviewPage } from '@/pages/producten/producten-overview'
import { ProductDetailPage } from '@/pages/producten/product-detail'
import { ProductCreatePage } from '@/pages/producten/product-create'
import { ProductEditPage } from '@/pages/producten/product-edit'
import { VertegenwoordigersOverviewPage } from '@/pages/vertegenwoordigers/vertegenwoordigers-overview'
import { VertegenwoordigerDetailPage } from '@/pages/vertegenwoordigers/vertegenwoordiger-detail'
import { PrijslijstenOverviewPage } from '@/pages/prijslijsten/prijslijsten-overview'
import { PrijslijstDetailPage } from '@/pages/prijslijsten/prijslijst-detail'
import { SnijplanningOverviewPage } from '@/modules/planning/pages/snijplanning-overview'
import { RolSnijvoorstelPage } from '@/modules/planning/pages/rol-snijvoorstel'
import { StickerPrintPage } from '@/modules/planning/pages/sticker-print'
import { StickersBulkPage } from '@/modules/planning/pages/stickers-bulk'
import { SnijvoorstelReviewPage } from '@/modules/planning/pages/snijvoorstel-review'
import { ProductieRolPage } from '@/modules/planning/pages/productie-rol'
import { ProductieGroepPage } from '@/modules/planning/pages/productie-groep'
import { ProductieInstellingenPage } from '@/pages/instellingen/productie-instellingen'
import { BedrijfsgegevensPage } from '@/pages/instellingen/bedrijfsgegevens'
import { ConfectieOverviewPage } from '@/modules/planning/pages/confectie-overview'
import { ConfectiePlanningPage } from '@/modules/planning/pages/confectie-planning'
import { ScanstationPage } from '@/pages/scanstation/scanstation'
import { RollenOverviewPage } from '@/pages/rollen/rollen-overview'
import { PickShipOverviewPage } from '@/pages/pick-ship/pick-ship-overview'
import { FacturatieOverviewPage } from '@/pages/facturatie/facturatie-overview'
import { FactuurDetailPage } from '@/pages/facturatie/factuur-detail'
import { InkooporderOverviewPage } from '@/pages/inkooporders/inkooporders-overview'
import { InkooporderDetailPage } from '@/pages/inkooporders/inkooporder-detail'
import { RolStickersPrintPage } from '@/pages/inkooporders/rol-stickers-print'
import { LeveranciersOverviewPage } from '@/pages/leveranciers/leveranciers-overview'
import { LeverancierDetailPage } from '@/pages/leveranciers/leverancier-detail'
import { EdiBerichtenOverzichtPage } from '@/modules/edi/pages/berichten-overzicht'
import { EdiBerichtDetailPage } from '@/modules/edi/pages/bericht-detail'
import {
  ZendingenOverzichtPage,
  ZendingDetailPage,
  ZendingPrintSetPage,
  VervoerdersOverzichtPage,
  VervoerderDetailPage,
} from '@/modules/logistiek'

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },

      // Orders (V1)
      { path: 'orders', element: <OrdersOverviewPage /> },
      { path: 'orders/nieuw', element: <OrderCreatePage /> },
      { path: 'orders/:id', element: <OrderDetailPage /> },
      { path: 'orders/:id/bewerken', element: <OrderEditPage /> },

      // Klanten (V1)
      { path: 'klanten', element: <KlantenOverviewPage /> },
      { path: 'klanten/:id', element: <KlantDetailPage /> },

      // Producten (V1)
      { path: 'producten', element: <ProductenOverviewPage /> },
      { path: 'producten/nieuw', element: <ProductCreatePage /> },
      { path: 'producten/:id', element: <ProductDetailPage /> },
      { path: 'producten/:id/bewerken', element: <ProductEditPage /> },

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
      { path: 'snijplanning/rol/:rolId', element: <RolSnijvoorstelPage /> },
      { path: 'snijplanning/voorstel/:voorstelId', element: <SnijvoorstelReviewPage /> },
      { path: 'snijplanning/:id/stickers', element: <StickerPrintPage /> },
      { path: 'snijplanning/stickers', element: <StickersBulkPage /> },
      { path: 'snijplanning/productie', element: <ProductieGroepPage /> },
      { path: 'snijplanning/productie/:rolId', element: <ProductieRolPage /> },
      { path: 'confectie', element: <ConfectieOverviewPage /> },
      { path: 'confectie/planning', element: <ConfectiePlanningPage /> },
      { path: 'pick-ship', element: <PickShipOverviewPage /> },
      { path: 'logistiek', element: <ZendingenOverzichtPage /> },
      // Belangrijk: vervoerders-routes vóór `:zending_nr` om matching-conflict te vermijden.
      { path: 'logistiek/vervoerders', element: <VervoerdersOverzichtPage /> },
      { path: 'logistiek/vervoerders/:code', element: <VervoerderDetailPage /> },
      { path: 'logistiek/:zending_nr/printset', element: <ZendingPrintSetPage /> },
      { path: 'logistiek/:zending_nr', element: <ZendingDetailPage /> },
      { path: 'inkoop', element: <InkooporderOverviewPage /> },
      { path: 'inkoop/:id', element: <InkooporderDetailPage /> },
      { path: 'leveranciers', element: <LeveranciersOverviewPage /> },
      { path: 'leveranciers/:id', element: <LeverancierDetailPage /> },

      // EDI / Transus
      { path: 'edi/berichten', element: <EdiBerichtenOverzichtPage /> },
      { path: 'edi/berichten/:id', element: <EdiBerichtDetailPage /> },

      { path: 'instellingen', element: <ProductieInstellingenPage /> },
      { path: 'instellingen/productie', element: <ProductieInstellingenPage /> },
      { path: 'instellingen/bedrijfsgegevens', element: <BedrijfsgegevensPage /> },
    ],
  },
])
