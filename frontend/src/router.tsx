import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '@/components/layout/app-layout'
import { DashboardPage } from '@/pages/dashboard'
import { PlaceholderPage } from '@/pages/placeholder'
import { OrdersOverviewPage } from '@/pages/orders/orders-overview'
import { OrderDetailPage } from '@/pages/orders/order-detail'
import { OrderCreatePage } from '@/pages/orders/order-create'
import { OrderEditPage } from '@/pages/orders/order-edit'
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
import { SnijplanningOverviewPage } from '@/pages/snijplanning/snijplanning-overview'
import { RolSnijvoorstelPage } from '@/pages/snijplanning/rol-snijvoorstel'
import { StickerPrintPage } from '@/pages/snijplanning/sticker-print'
import { StickersBulkPage } from '@/pages/snijplanning/stickers-bulk'
import { SnijvoorstelReviewPage } from '@/pages/snijplanning/snijvoorstel-review'
import { ProductieRolPage } from '@/pages/snijplanning/productie-rol'
import { ProductieGroepPage } from '@/pages/snijplanning/productie-groep'
import { ProductieInstellingenPage } from '@/pages/instellingen/productie-instellingen'
import { BedrijfsgegevensPage } from '@/pages/instellingen/bedrijfsgegevens'
import { ConfectieOverviewPage } from '@/pages/confectie/confectie-overview'
import { ConfectiePlanningPage } from '@/pages/confectie/confectie-planning'
import { ScanstationPage } from '@/pages/scanstation/scanstation'
import { RollenOverviewPage } from '@/pages/rollen/rollen-overview'
import { MagazijnOverviewPage } from '@/pages/magazijn/magazijn-overview'
import { FacturatieOverviewPage } from '@/pages/facturatie/facturatie-overview'
import { FactuurDetailPage } from '@/pages/facturatie/factuur-detail'
import { InkooporderOverviewPage } from '@/pages/inkooporders/inkooporders-overview'
import { InkooporderDetailPage } from '@/pages/inkooporders/inkooporder-detail'
import { RolStickersPrintPage } from '@/pages/inkooporders/rol-stickers-print'
import { LeveranciersOverviewPage } from '@/pages/leveranciers/leveranciers-overview'
import { LeverancierDetailPage } from '@/pages/leveranciers/leverancier-detail'
import { EdiBerichtenOverzichtPage } from '@/pages/edi/berichten-overzicht'
import { EdiBerichtDetailPage } from '@/pages/edi/bericht-detail'

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
      { path: 'magazijn', element: <MagazijnOverviewPage /> },
      { path: 'snijplanning', element: <SnijplanningOverviewPage /> },
      { path: 'snijplanning/rol/:rolId', element: <RolSnijvoorstelPage /> },
      { path: 'snijplanning/voorstel/:voorstelId', element: <SnijvoorstelReviewPage /> },
      { path: 'snijplanning/:id/stickers', element: <StickerPrintPage /> },
      { path: 'snijplanning/stickers', element: <StickersBulkPage /> },
      { path: 'snijplanning/productie', element: <ProductieGroepPage /> },
      { path: 'snijplanning/productie/:rolId', element: <ProductieRolPage /> },
      { path: 'confectie', element: <ConfectieOverviewPage /> },
      { path: 'confectie/planning', element: <ConfectiePlanningPage /> },
      { path: 'pick-ship', element: <PlaceholderPage title="Pick & Ship" /> },
      { path: 'logistiek', element: <PlaceholderPage title="Logistiek" /> },
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
