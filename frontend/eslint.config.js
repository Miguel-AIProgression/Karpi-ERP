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
        ],
        patterns: [
          { group: ['@/components/klanten/*'], message: 'Gebruik @/modules/debiteuren (ADR-0011).' },
          { group: ['@/pages/klanten/*'], message: 'Gebruik @/modules/debiteuren (ADR-0011).' },
          { group: ['@/lib/snij-volgorde/*'], message: 'Gebruik @/modules/snijplanning (ADR-0013).' },
        ],
      }],
    },
  },
])
