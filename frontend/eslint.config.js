import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: '@/lib/supabase/queries/op-maat', message: 'Gebruik @/modules/maatwerk (ADR-0009).' },
          { name: '@/lib/utils/maatwerk-prijs', message: 'Gebruik @/modules/maatwerk (ADR-0009).' },
          { name: '@/lib/utils/maatwerk-leverdatum', message: 'Gebruik @/modules/maatwerk (ADR-0009).' },
          { name: '@/lib/supabase/queries/klanten', message: 'Gebruik @/modules/debiteuren (ADR-0011).' },
          { name: '@/lib/supabase/queries/klanteigen-namen', message: 'Gebruik @/modules/debiteuren (ADR-0011).' },
          { name: '@/hooks/use-klanten', message: 'Gebruik @/modules/debiteuren (ADR-0011); useVertegenwoordigers leeft in @/hooks/use-medewerkers; useKleurenVoorKwaliteit in @/hooks/use-producten.' },
          { name: '@/hooks/use-klanteigen-namen', message: 'Gebruik @/modules/debiteuren (ADR-0011).' },
          { name: '@/hooks/use-snijplanning', message: 'Gebruik @/modules/snijplanning (ADR-0013).' },
          { name: '@/lib/supabase/queries/snijplanning', message: 'Gebruik @/modules/snijplanning (ADR-0013).' },
          { name: '@/lib/supabase/queries/snijplanning-mutations', message: 'Gebruik @/modules/snijplanning (ADR-0013).' },
          { name: '@/lib/supabase/queries/snijvoorstel', message: 'Gebruik @/modules/snijplanning (ADR-0013).' },
          { name: '@/lib/supabase/queries/auto-planning', message: 'Gebruik @/modules/snijplanning (ADR-0013).' },
          { name: '@/lib/utils/compute-reststukken', message: 'Gebruik @/modules/snijplanning (ADR-0013).' },
          { name: '@/lib/utils/snijplan-mapping', message: 'Gebruik @/modules/snijplanning (ADR-0013).' },
          { name: '@/lib/supabase/queries/reserveringen', message: 'Importeer via @/modules/reserveringen (ADR-0015).' },
          { name: '@/lib/utils/regel-dekking', message: 'Gebruik berekenRegelDekking uit @/modules/reserveringen (ADR-0015).' },
          { name: '@/hooks/use-reserveringen', message: 'Gebruik hooks uit @/modules/reserveringen (ADR-0015).' },
          { name: '@/components/orders/regel-claim-detail', message: 'Gebruik components uit @/modules/reserveringen (ADR-0015).' },
          { name: '@/components/orders/substitution-picker', message: 'Gebruik components uit @/modules/reserveringen (ADR-0015).' },
          { name: '@/components/orders/uitwisselbaar-tekort-hint', message: 'Gebruik components uit @/modules/reserveringen (ADR-0015).' },
          { name: '@/components/orders/levertijd-badge', message: 'Gebruik components uit @/modules/reserveringen (ADR-0015).' },
          { name: '@/lib/supabase/queries/inkooporders', message: 'Importeer uit @/modules/inkoop (ADR-0016).' },
          { name: '@/lib/supabase/queries/leveranciers', message: 'Importeer uit @/modules/inkoop (ADR-0016).' },
          { name: '@/hooks/use-inkooporders', message: 'Importeer uit @/modules/inkoop (ADR-0016).' },
          { name: '@/hooks/use-leveranciers', message: 'Importeer uit @/modules/inkoop (ADR-0016).' },
          { name: '@/hooks/use-levertijd-check', message: 'use-levertijd-check is DEPRECATED (ADR-0020). Gebruik useFitCheck uit @/modules/levertijd.' },
        ],
        patterns: [
          { group: ['@/components/klanten/*'], message: 'Gebruik @/modules/debiteuren (ADR-0011).' },
          { group: ['@/pages/klanten/*'], message: 'Gebruik @/modules/debiteuren (ADR-0011).' },
          { group: ['@/lib/snij-volgorde/*'], message: 'Gebruik @/modules/snijplanning (ADR-0013).' },
          { group: ['@/components/inkooporders/*'], message: 'Components zijn verhuisd naar @/modules/inkoop (ADR-0016).' },
          { group: ['@/pages/inkooporders/*'], message: 'Pages zijn verhuisd naar @/modules/inkoop/pages (ADR-0016).' },
          { group: ['@/pages/leveranciers/*'], message: 'Pages zijn verhuisd naar @/modules/inkoop/pages (ADR-0016).' },
          { group: ['@/components/leveranciers/*'], message: 'Components zijn verhuisd naar @/modules/inkoop (ADR-0016).' },
        ],
      }],
    },
  },
  // ADR-0020 / Levertijd-Module stap 9 — severity-uitzondering.
  //
  // De org-brede no-restricted-imports staat op 'error' (sterke afschrikking
  // voor NIEUWE code die de DEPRECATED shim @/hooks/use-levertijd-check
  // importeert). Maar de shim zelf en z'n enige huidige back-compat-caller
  // bestaan bewust nog 1 release; die zouden de CI rood maken op 'error'.
  // Daarom hier 1 vervolg-config-object dat — alléén voor die twee bekende
  // bestanden — no-restricted-imports op 'warn' zet (flat-config: laatste
  // matchende rule-declaratie wint per bestand). Deze twee bestanden
  // importeren geen enkel ander restricted Module-pad (geverifieerd), dus de
  // ADR-0015/0016-handhaving elders blijft onverminderd op 'error'.
  {
    files: [
      'src/hooks/use-levertijd-check.ts',
      'src/components/orders/levertijd-suggestie.tsx',
    ],
    rules: {
      'no-restricted-imports': ['warn', {
        paths: [
          { name: '@/hooks/use-levertijd-check', message: 'use-levertijd-check is DEPRECATED (ADR-0020). Gebruik useFitCheck uit @/modules/levertijd.' },
        ],
      }],
    },
  },
])
