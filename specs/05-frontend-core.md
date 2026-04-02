# Spec: Frontend Core

## Wat dit oplost

De basis-infrastructuur voor de React frontend: project setup, layout, routing, Supabase-connectie en gedeelde componenten. Dit is het fundament waarop alle feature-modules gebouwd worden.

## Tech Stack

- **React 18+** met TypeScript
- **Vite** als build tool
- **TailwindCSS** voor styling
- **shadcn/ui** als component library
- **React Router** voor routing
- **TanStack Query (React Query)** voor data fetching/caching
- **Supabase JS client** voor database/auth/storage

## Structuur

```
frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Sidebar + topbar wrapper
│   │   └── routes.tsx              # Route definities
│   ├── components/
│   │   ├── layout/
│   │   │   ├── sidebar.tsx         # Navigatie (groepen: Overzicht, Commercieel, Operationeel, Systeem)
│   │   │   ├── top-bar.tsx         # Global search + user menu
│   │   │   └── page-header.tsx     # Titel + breadcrumb + actieknoppen
│   │   └── ui/                     # shadcn/ui componenten
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts           # Supabase client initialisatie
│   │   │   └── types.ts            # Generated types (supabase gen types)
│   │   └── utils/
│   │       ├── formatters.ts       # € bedragen, datums, percentages
│   │       └── constants.ts        # Status kleuren, tier definities, nav items
│   └── hooks/
│       └── use-supabase-query.ts   # Basis hook voor Supabase + React Query
├── .env                            # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── vite.config.ts
```

## Design systeem (uit mockups)

De HTML mockups gebruiken een consistent design:

- **Dark sidebar** (slate-900) met lichte tekst
- **Lichte content area** (slate-50/white)
- **Terracotta accent** (#d4572a) voor primaire acties en actieve states
- **Fonts**: Instrument Serif (headings), DM Sans (body)
- **Border radius**: 12px (cards), 8px (buttons/inputs)
- **Sidebar breedte**: 260px, topbar hoogte: 64px

### Sidebar navigatiegroepen

```
OVERZICHT
  Dashboard

COMMERCIEEL
  Orders
  Samples
  Facturatie
  Klanten
  Vertegenwoordigers

PRODUCTEN & VOORRAAD
  Producten
  Rollen & Reststukken
  Scanstation

OPERATIONEEL
  Snijplanning
  Confectie
  Pick & Ship
  Logistiek

INKOOP
  Inkooporders
  Leveranciers

SYSTEEM
  Instellingen
```

## Acceptatiecriteria

1. `npm run dev` start de applicatie zonder errors
2. Sidebar navigatie toont alle groepen en pagina's
3. Routing werkt: elke sidebar-link navigeert naar de juiste pagina (initieel placeholder)
4. Supabase client is geconfigureerd en kan verbinding maken
5. TypeScript types zijn gegenereerd vanuit het Supabase schema
6. Layout is responsive: sidebar klapt in op mobiel
7. Design tokens (kleuren, fonts, spacing) komen overeen met de mockups
8. React Query is geconfigureerd met een QueryClientProvider

## Edge cases

- Zonder auth toont de app niets (redirect naar login) — maar auth-implementatie is V2
- Voor V1: auth overslaan of een simpele check (Supabase session)
- Pagina's die nog niet gebouwd zijn tonen een placeholder met de paginanaam

## Dependencies

- Spec 01 (mappenstructuur) — `frontend/` directory
- Spec 03 (database) — TypeScript types worden gegenereerd vanuit het Supabase schema
