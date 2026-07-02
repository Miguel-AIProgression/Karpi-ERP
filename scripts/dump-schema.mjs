// scripts/dump-schema.mjs — dumpt alle live public-functies + views naar
// supabase/schema/ (de canonieke "welke body is nu live"-bron).
// Draaien na elke toegepaste migratie: `node scripts/dump-schema.mjs`
// Node i.p.v. PowerShell: PS 5.1-pipes verminken BOM-loos UTF-8 (mojibake op
// em-dashes/diakrieten — reference_ps51_utf8_mojibake; live geraakt 2026-07-02
// bij de eerste ps1-versie). Queries gaan via een tempfile + `db query -f`
// (geen shell-quoting van SQL — cmd.exe sloopte de inline variant).
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = mkdtempSync(join(tmpdir(), 'dump-schema-'))

function dbQueryFile(sql) {
  const f = join(tmp, 'q.sql')
  writeFileSync(f, sql, 'utf8')
  // execSync + gequoteerd pad: Node >=20 weigert .cmd-spawns zonder shell
  // (EINVAL), en het tmp-pad is het enige argument met quote-risico.
  const out = execSync(`supabase db query --linked -o json -f "${f}"`, {
    cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
  })
  const parsed = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1))
  if (!parsed.rows?.[0]?.defs) throw new Error('dump-schema: lege defs — CLI-output: ' + out.slice(0, 400))
  return parsed.rows[0].defs
}

const fnDefs = dbQueryFile(
  "SELECT string_agg(pg_get_functiondef(p.oid), E'\\n\\n' ORDER BY p.proname) AS defs\n" +
  "FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace\n" +
  "WHERE n.nspname = 'public' AND p.prokind = 'f';\n",
)
writeFileSync(join(root, 'supabase/schema/functies.sql'),
  '-- GEGENEREERD: alle public-functies van de live DB (audit-remediatie Task 4.1).\n' +
  '-- Ververs met: node scripts/dump-schema.mjs   (NIET handmatig bewerken)\n\n' +
  fnDefs + '\n', 'utf8')

const vwDefs = dbQueryFile(
  "SELECT string_agg(format(E'CREATE OR REPLACE VIEW %I AS\\n%s', viewname, definition), E'\\n\\n' ORDER BY viewname) AS defs\n" +
  'FROM pg_views WHERE schemaname = \'public\';\n',
)
writeFileSync(join(root, 'supabase/schema/views.sql'),
  '-- GEGENEREERD: alle public-views van de live DB (audit-remediatie Task 4.1).\n\n' +
  vwDefs + '\n', 'utf8')

rmSync(tmp, { recursive: true, force: true })
console.log('OK: supabase/schema/functies.sql + views.sql ververst — commit ze mee.')
