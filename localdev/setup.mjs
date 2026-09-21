/**
 * Creates (or rebuilds) the local development database.
 *
 *   node localdev/setup.mjs          create it if it is missing
 *   node localdev/setup.mjs --reset  drop it and rebuild from scratch
 *
 * The schema is destructive by design, so `--reset` is the way back to a clean
 * slate after experimenting with events or site copy.
 *
 * Whichever way it runs, it finishes by writing the development site key into
 * the database — including when it reuses one that already exists. A local key
 * that was replaced from the panel is therefore restored the next time the site
 * is started, which is what keeps "I changed it and forgot it" from becoming
 * "reset the database".
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from 'pg'
import { ADMIN_URL, DATABASE_NAME, DATABASE_URL, DEV_SITE_KEY } from './config.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const schemaPath = path.join(here, 'schema.sql')

const reset = process.argv.includes('--reset')

const admin = new pg.Client({ connectionString: ADMIN_URL })

async function databaseExists() {
  const { rows } = await admin.query('select 1 from pg_database where datname = $1', [DATABASE_NAME])
  return rows.length > 0
}

async function main() {
  await admin.connect()

  const exists = await databaseExists()
  const fresh = !exists || reset

  if (exists && reset) {
    // Nothing else is connected to it, so this is enough to clear the slate.
    await admin.query(`drop database "${DATABASE_NAME}" with (force)`)
    console.log(`dropped  ${DATABASE_NAME}`)
  }

  if (fresh) {
    if (!exists || reset) {
      await admin.query(`create database "${DATABASE_NAME}"`)
      console.log(`created  ${DATABASE_NAME}`)
    }
    const schema = await readFile(schemaPath, 'utf8')
    const db = new pg.Client({ connectionString: DATABASE_URL })
    await db.connect()
    await db.query(schema)
    await db.end()
    console.log('applied  schema.sql')
  } else {
    // Applying the schema means dropping and rebuilding every table, so it is
    // deliberately not repeated on an existing database: the events and site
    // copy created while testing are meant to survive a restart.
    console.log(`reusing  ${DATABASE_NAME}`)
    console.log('         (npm run local:reset rebuilds it, discarding its contents)')
  }

  const check = new pg.Client({ connectionString: DATABASE_URL })
  await check.connect()

  // The key the development database accepts, written from `config.mjs` rather
  // than from `schema.sql` so that there is one definition of it. It is stored
  // the way production stores its own: as a SHA-256, with the key itself never
  // reaching the database.
  await check.query(
    `insert into public.site_access (key_hash)
     values (encode(sha256(convert_to($1, 'utf8')), 'hex'))
     on conflict (only_row) do update
       set key_hash = excluded.key_hash, updated_at = now()`,
    [DEV_SITE_KEY],
  )
  console.log(`key      this database accepts: ${DEV_SITE_KEY}`)

  const { rows } = await check.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' order by table_name`,
  )
  await check.end()
  console.log(`tables   ${rows.map((r) => r.table_name).join(', ')}`)
  console.log('\nReady. Start the site with:  npm run local')
}

main()
  .catch((err) => {
    console.error('\nSetup failed:', err.message)
    if (err.code === 'ECONNREFUSED') {
      console.error('Is PostgreSQL running?  brew services start postgresql@18')
    }
    process.exitCode = 1
  })
  .finally(() => admin.end().catch(() => {}))
