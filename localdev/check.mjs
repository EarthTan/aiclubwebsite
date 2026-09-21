/**
 * End-to-end check of the local backend.
 *
 *   npm run local:check
 *
 * Builds a throwaway database, starts the API against it, and walks the same
 * path a person would: read the site anonymously, present the site key, write
 * an event and the site copy, archive and delete what was written, replace the
 * key and confirm that the old one stops working, and confirm that every write
 * is refused without it. A few assertions bypass the API and talk to the
 * database directly, so that the privilege model is tested rather than the
 * shim's willingness to pass a request through.
 *
 * The database is dropped afterwards, so this never touches the development
 * data.
 */

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from 'pg'
import { ADMIN_URL, DEV_SITE_KEY } from './config.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const DB = 'dku_ai_club_local_check'
const PORT = 54399
const API = `http://127.0.0.1:${PORT}/api`

const KEY = DEV_SITE_KEY
const NEXT_KEY = 'a-replacement-key-that-is-long-enough'
const WRONG_KEY = 'not-the-site-key-at-all-no'

let passed = 0
let failed = 0

function check(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function post(pathname, body) {
  return fetch(`${API}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }).then((r) => r.json())
}

const db = (request) => post('/db', request)
const rpc = (fn, args) => post('/rpc', { fn, args })

async function main() {
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  let probe = null
  let server = null

  /** Releases everything this run opened, whether it succeeded or threw. */
  const stop = async () => {
    if (server) {
      server.kill('SIGTERM')
      await new Promise((resolve) => server.once('exit', resolve))
    }
    if (probe) await probe.end().catch(() => {})
    await admin.end().catch(() => {})
  }

  /**
   * Runs one statement as `anon`, the only role this site ever acts as. This is
   * the same route a browser takes, minus the API in between.
   */
  const asAnon = async (sql, params = []) => {
    await probe.query('begin')
    try {
      await probe.query('set local role anon')
      const result = await probe.query(sql, params)
      await probe.query('commit')
      return { rows: result.rows }
    } catch (error) {
      await probe.query('rollback').catch(() => {})
      return { error }
    }
  }

  try {
    /* -------------------------------------------------------------- setup */

    await admin.connect()
    await admin.query(`drop database if exists "${DB}" with (force)`)
    await admin.query(`create database "${DB}"`)
    const targetUrl = `${ADMIN_URL.replace(/\/postgres$/, '')}/${DB}`
    const target = new pg.Client({ connectionString: targetUrl })
    await target.connect()
    await target.query(await readFile(path.join(here, 'schema.sql'), 'utf8'))
    // The key is seeded the way `setup.mjs` seeds it, from the same setting.
    await target.query(
      `insert into public.site_access (key_hash)
       values (encode(sha256(convert_to($1, 'utf8')), 'hex'))`,
      [KEY],
    )
    const stored = await target.query('select key_hash from public.site_access')
    await target.end()

    probe = new pg.Client({ connectionString: targetUrl })
    await probe.connect()

    check(
      'the database stores a hash, not the key itself',
      stored.rows[0]?.key_hash === createHash('sha256').update(KEY).digest('hex'),
    )

    server = spawn(process.execPath, [path.join(here, 'server.mjs')], {
      cwd: root,
      env: { ...process.env, LOCAL_DB_NAME: DB, LOCAL_API_PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    server.stderr.on('data', (chunk) => process.stderr.write(`  api: ${chunk}`))

    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const health = await fetch(`${API}/health`)
        if (health.ok) break
      } catch {
        /* not up yet */
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }

    /* ------------------------------------------------------------ the site */

    console.log('\nBrowsing as a visitor')
    const events = await db({ table: 'events', action: 'select', columns: '*', filters: [] })
    check('the event library reads (empty until the archive is imported)', Array.isArray(events.data))
    const settings = await db({
      table: 'site_settings',
      action: 'select',
      columns: 'value',
      filters: [{ op: 'eq', column: 'key', value: 'site' }],
      mode: 'maybeSingle',
    })
    check('site copy reads as absent, so the built-in defaults apply', settings.data === null)

    const refused = await db({
      table: 'events',
      action: 'insert',
      payload: { slug: 'nope', title: 'Nope', event_date: '2026-01-01' },
    })
    check('a visitor cannot write to the event library', refused.error?.code === '42501')

    const directWrite = await asAnon(
      `insert into public.events (slug, title, event_date) values ('direct', 'Direct', '2026-01-01')`,
    )
    check(
      'and the table itself grants no write, whatever the API is willing to send',
      directWrite.error?.code === '42501',
      directWrite.error?.code,
    )

    console.log('\nLooking for the key')
    const reader = await asAnon('select key_hash from public.site_access')
    check('the key table is unreadable from the site', reader.error?.code === '42501', reader.error?.code)

    const ok = await rpc('site_key_ok', { candidate: KEY })
    check('the development key is accepted', ok.data === true)
    const wrong = await rpc('site_key_ok', { candidate: WRONG_KEY })
    check('a key that is not the site key is refused', wrong.data === false)
    const short = await rpc('site_key_ok', { candidate: 'short' })
    check('a key below the length floor is refused outright', short.data === false)
    const empty = await rpc('site_key_ok', { candidate: '' })
    check('an empty key is refused', empty.data === false)

    const gate = await asAnon('select public.require_site_key($1)', [KEY])
    check(
      'the gate itself is not callable by the site, only by the functions that use it',
      gate.error?.code === '42501',
      gate.error?.code,
    )

    /* --------------------------------------------------------------- writing */

    console.log('\nWriting with the key')
    const noKey = await rpc('admin_list_events', { p_key: WRONG_KEY })
    check('the panel library refuses a key it does not recognise', noKey.error?.code === '42501')
    const missingKey = await rpc('admin_list_events', {})
    check(
      'a call that omits the key does not resolve to a function at all',
      missingKey.error?.code === '42883',
      missingKey.error?.code,
    )

    const listed = await rpc('admin_list_events', { p_key: KEY })
    check('the panel library reads with the key', Array.isArray(listed.data))

    const created = await rpc('admin_save_event', {
      p_key: KEY,
      p_event: {
        slug: 'local-test-event',
        title: 'A locally created event',
        summary: 'Created against the local database.',
        body: '## Heading\n\nBody text.',
        category: 'Workshop',
        event_date: '2026-05-05',
        gallery: ['/images/events/banner.jpg'],
        tags: ['test'],
        status: 'published',
        featured: true,
      },
    })
    check('an event can be created', created.data?.slug === 'local-test-event')
    check('its gallery round-trips as json', Array.isArray(created.data?.gallery))
    check(
      'its tags round-trip as a list',
      Array.isArray(created.data?.tags) && created.data.tags[0] === 'test',
      `got ${JSON.stringify(created.data?.tags)}`,
    )
    check(
      'the date comes back as the calendar day that was written',
      created.data?.event_date === '2026-05-05',
      `got ${JSON.stringify(created.data?.event_date)}`,
    )
    // The ownership columns are filled from the caller's identity, which a
    // caller cannot supply. What they hold differs between the two databases —
    // the hosted one stamps the anonymous role's name — so the assertion is on
    // the value having been ignored, not on what it was replaced with.
    const claiming = await rpc('admin_save_event', {
      p_key: KEY,
      p_event: { slug: 'local-claim', title: 'Claim', event_date: '2026-05-07', owner_id: 'someone-else' },
    })
    check(
      'a caller cannot choose who owns a row',
      claiming.data?.owner_id !== 'someone-else',
      `got ${JSON.stringify(claiming.data?.owner_id)}`,
    )
    await rpc('admin_delete_event', { p_key: KEY, p_slug: 'local-claim' })

    const draft = await rpc('admin_save_event', {
      p_key: KEY,
      p_event: { slug: 'local-draft', title: 'Draft', event_date: '2026-05-06', status: 'draft' },
    })
    check('a draft can be created', draft.data?.status === 'draft')

    const publicView = await db({ table: 'events', action: 'select', columns: 'slug', filters: [] })
    const slugs = (publicView.data ?? []).map((row) => row.slug)
    check('the published event is visible to visitors', slugs.includes('local-test-event'))
    check('the draft is hidden from visitors', !slugs.includes('local-draft'))

    const panelLibrary = await rpc('admin_list_events', { p_key: KEY })
    const panelSlugs = (panelLibrary.data ?? []).map((row) => row.slug)
    check('the panel sees the draft as well', panelSlugs.includes('local-draft'))

    const overwritten = await rpc('admin_save_event', {
      p_key: KEY,
      p_event: {
        slug: 'local-test-event',
        title: 'Renamed locally',
        event_date: '2026-05-05',
        status: 'published',
      },
    })
    check('saving the same slug overwrites rather than duplicating', overwritten.data?.title === 'Renamed locally')
    const stillTwo = await rpc('admin_list_events', { p_key: KEY })
    check('the library still holds one row per slug', (stillTwo.data ?? []).length === 2)

    const published = await rpc('admin_set_event_status', {
      p_key: KEY,
      p_slug: 'local-draft',
      p_status: 'published',
    })
    check('an event can be published', published.data === true)
    const nowVisible = await db({ table: 'events', action: 'select', columns: 'slug', filters: [] })
    check(
      'a published event joins the public library',
      (nowVisible.data ?? []).some((row) => row.slug === 'local-draft'),
    )

    const archived = await rpc('admin_set_event_status', {
      p_key: KEY,
      p_slug: 'local-test-event',
      p_status: 'archived',
    })
    check('an event can be archived', archived.data === true)
    const afterArchive = await db({ table: 'events', action: 'select', columns: 'slug', filters: [] })
    check(
      'an archived event leaves the public library',
      !(afterArchive.data ?? []).some((row) => row.slug === 'local-test-event'),
    )

    const oddStatus = await rpc('admin_set_event_status', {
      p_key: KEY,
      p_slug: 'local-test-event',
      p_status: 'deleted',
    })
    check('a status the site does not use is refused', oddStatus.error?.code === '22023')
    const noSuchEvent = await rpc('admin_set_event_status', {
      p_key: KEY,
      p_slug: 'never-existed',
      p_status: 'published',
    })
    check('changing an event that is not there reports false', noSuchEvent.data === false)

    const settingsWrite = await rpc('admin_save_settings', {
      p_key: KEY,
      p_value: { club_name: 'DKU AI Club', contact_email: 'dkuaiclub@outlook.com' },
    })
    check('site copy can be saved', settingsWrite.data === true)
    const readBack = await db({
      table: 'site_settings',
      action: 'select',
      columns: 'value',
      filters: [{ op: 'eq', column: 'key', value: 'site' }],
      mode: 'maybeSingle',
    })
    check(
      'saved site copy reads back for visitors',
      readBack.data?.value?.contact_email === 'dkuaiclub@outlook.com',
    )
    const settingsRefused = await rpc('admin_save_settings', {
      p_key: WRONG_KEY,
      p_value: { club_name: 'Someone else' },
    })
    check('site copy cannot be saved without the key', settingsRefused.error?.code === '42501')

    const removed = await rpc('admin_delete_event', { p_key: KEY, p_slug: 'local-test-event' })
    check('an event can be deleted', removed.data === true)
    const gone = await rpc('admin_list_events', { p_key: KEY })
    check(
      'the deleted event is gone from the library',
      !(gone.data ?? []).some((row) => row.slug === 'local-test-event'),
    )
    const removedAgain = await rpc('admin_delete_event', { p_key: KEY, p_slug: 'local-test-event' })
    check('deleting it again reports false rather than failing silently', removedAgain.data === false)

    /* ----------------------------------------------------- replacing the key */

    console.log('\nReplacing the key')
    const wrongCurrent = await rpc('admin_replace_site_key', {
      p_current: WRONG_KEY,
      p_next: NEXT_KEY,
    })
    check('the current key has to be supplied', wrongCurrent.error?.code === '42501')

    const tooShort = await rpc('admin_replace_site_key', { p_current: KEY, p_next: 'short' })
    check('a replacement that is too short is refused', tooShort.error?.code === '22023')

    const replaced = await rpc('admin_replace_site_key', { p_current: KEY, p_next: NEXT_KEY })
    check('the key can be replaced with the current one in hand', replaced.data === true)

    const oldKey = await rpc('site_key_ok', { candidate: KEY })
    check('the old key stops being accepted', oldKey.data === false)
    const newKey = await rpc('site_key_ok', { candidate: NEXT_KEY })
    check('the new key is accepted', newKey.data === true)

    const oldWrite = await rpc('admin_list_events', { p_key: KEY })
    check('the old key can no longer write', oldWrite.error?.code === '42501')
    const newWrite = await rpc('admin_list_events', { p_key: NEXT_KEY })
    check('the new key can write', Array.isArray(newWrite.data))

    /* --------------------------------------------------------------- guards */

    console.log('\nRefusing unsafe statements')
    const massUpdate = await db({ table: 'events', action: 'update', payload: { status: 'archived' } })
    check('an update with no filter is refused', massUpdate.error?.code === 'BAD_REQUEST')
    const massDelete = await db({ table: 'events', action: 'delete' })
    check('a delete with no filter is refused', massDelete.error?.code === 'BAD_REQUEST')
    const unknown = await db({ table: 'users', action: 'select', filters: [] })
    check('an unknown table is refused', unknown.error?.code === 'BAD_REQUEST')

    const injection = await rpc('admin_list_events; drop table public.events', { p_key: NEXT_KEY })
    check('a function name that is not a bare identifier is refused', injection.error?.code === 'BAD_REQUEST')
    const unknownArg = await rpc('site_key_ok', { candidate: NEXT_KEY, nonsense: 1 })
    check(
      'an argument the function does not take is refused',
      unknownArg.error?.code === '42883',
      unknownArg.error?.code,
    )
    const badArgName = await rpc('site_key_ok', { 'drop table public.events': NEXT_KEY })
    check(
      'an argument name that is not a bare identifier is refused',
      badArgName.error?.code === 'BAD_REQUEST',
      badArgName.error?.code,
    )

    const stillThere = await db({ table: 'events', action: 'select', columns: 'slug', filters: [] })
    check('the events table survived all of that', Array.isArray(stillThere.data))
  } finally {
    await stop()
  }

  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exitCode = failed === 0 ? 0 : 1
}

main().catch((error) => {
  console.error('\nThe check could not run:', error.message)
  process.exitCode = 1
})
