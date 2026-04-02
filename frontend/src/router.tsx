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
      { path: 'producten/:id', element: <ProductDetailPage /> },

      // Placeholders (V2+)
      { path: 'samples', element: <PlaceholderPage title="Samples" /> },
      { path: 'facturatie', element: <PlaceholderPage title="Facturatie" /> },
      { path: 'vertegenwoordigers', element: <PlaceholderPage title="Vertegenwoordigers" /> },
      { path: 'rollen', element: <PlaceholderPage title="Rollen & Reststukken" /> },
      { path: 'scanstation', element: <PlaceholderPage title="Scanstation" /> },
      { path: 'magazijn', element: <PlaceholderPage title="Magazijn" /> },
      { path: 'snijplanning', element: <PlaceholderPage title="Snijplanning" /> },
      { path: 'confectie', element: <PlaceholderPage title="Confectie" /> },
      { path: 'pick-ship', element: <PlaceholderPage title="Pick & Ship" /> },
      { path: 'logistiek', element: <PlaceholderPage title="Logistiek" /> },
      { path: 'inkoop', element: <PlaceholderPage title="Inkooporders" /> },
      { path: 'leveranciers', element: <PlaceholderPage title="Leveranciers" /> },
      { path: 'instellingen', element: <PlaceholderPage title="Instellingen" /> },
    ],
  },
])
