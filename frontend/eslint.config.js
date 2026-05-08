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
        ],
      }],
    },
  },
])
