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
      // Module-discipline: externe consumers mogen alleen via de barrel importeren,
      // niet rechtstreeks uit `internal/` sub-folders van een andere module.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/modules/*/internal/**'],
              message:
                'Importeer via de module-barrel (index.ts), niet uit internal/ sub-folders.',
            },
          ],
        },
      ],
    },
  },
])
