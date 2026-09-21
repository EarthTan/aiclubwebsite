/**
 * End-to-end checks for the site's Cloudflare back end.
 *
 * Runs the Worker in Cloudflare's own local runtime — a real D1 database and a
 * real R2 bucket, on this machine, with no account involved — against a state
 * directory of its own, so it never touches the database the site is using.
 *
 *   npm run cf:check
 *
 * What it is for: the site's access control is one key checked in one place,
 * and the public/private split of the event library rests entirely on it. Those
 * are the two things worth asserting after every change, so they are asserted
 * here rather than hoped for.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PERSIST = path.join(root, '.wrangler/check-state')
const PORT = Number(process.env.CHECK_PORT || 8788)
const BASE = `http://127.0.0.1:${PORT}`
const DB = 'dku-ai-club'

const localWrangler = path.join(root, 'node_modules/.bin/wrangler')
const wrangler = existsSync(localWrangler) ? localWrangler : 'wrangler'

/* -------------------------------------------------------------------------- */
/* A very small test harness                                                  */
/* -------------------------------------------------------------------------- */

let passed = 0
const failures = []

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function check(name, run) {
  try {
    const detail = await run()
    passed += 1
    console.log(`  ok    ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
    console.log(`  FAIL  ${name} — ${error.message}`)
  }
}

/* -------------------------------------------------------------------------- */
/* Talking to the Worker                                                      */
/* -------------------------------------------------------------------------- */

async function api(route, options = {}) {
  const headers = {}
  if (options.key) headers['x-site-key'] = options.key
  let body
  if (options.raw !== undefined) {
    headers['content-type'] = options.contentType ?? 'application/octet-stream'
    body = options.raw
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  const response = await fetch(BASE + route, { method: options.method ?? 'GET', headers, body })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* a non-JSON answer is itself worth seeing, so it is kept as text */
  }
  return { status: response.status, json, text, headers: response.headers }
}

/* -------------------------------------------------------------------------- */
/* Setup                                                                      */
/* -------------------------------------------------------------------------- */

function runWrangler(args, label) {
  const result = spawnSync(wrangler, args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(
      `${label} failed (exit ${result.status})\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    )
  }
}

let server = null

async function stopServer() {
  if (!server) return
  const child = server
  server = null
  child.kill('SIGTERM')
  await new Promise((resolve) => {
    child.once('exit', resolve)
    setTimeout(resolve, 5000)
  })
}

async function startServer() {
  const child = spawn(wrangler, ['dev', '--port', String(PORT), '--persist-to', PERSIST], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  })
  server = child
  const log = []
  child.stdout.on('data', (chunk) => log.push(String(chunk)))
  child.stderr.on('data', (chunk) => log.push(String(chunk)))

  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`wrangler dev exited early (code ${child.exitCode})\n${log.join('')}`)
    }
    try {
      const response = await fetch(`${BASE}/api/health`)
      if (response.ok) return
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
  throw new Error(`wrangler dev did not answer within two minutes\n${log.join('')}`)
}

/* -------------------------------------------------------------------------- */
/* The checks                                                                 */
/* -------------------------------------------------------------------------- */

const key = (await readFile(path.join(root, 'cloudflare/.site-key.txt'), 'utf8')).trim()
const otherKey = 'a-different-key-that-is-long-enough-to-pass'

await stopServer()
await rm(PERSIST, { recursive: true, force: true })

console.log('  --    preparing a database of its own')
runWrangler(
  ['d1', 'execute', DB, '--local', '--persist-to', PERSIST, '--file', 'cloudflare/schema.sql'],
  'the schema',
)
runWrangler(
  ['d1', 'execute', DB, '--local', '--persist-to', PERSIST, '--file', 'cloudflare/seed.sql'],
  'the seed',
)

console.log('  --    starting the Worker')
await startServer()
console.log('')

try {
  /* ---- the seeded library ------------------------------------------------ */

  await check('the database holds the 12 seeded events', async () => {
    const { json } = await api('/api/health')
    assert(json?.events === 12, `expected 12 events, saw ${json?.events}`)
    return `${json.events} events`
  })

  await check('the public list is the published library, newest first', async () => {
    const { status, json } = await api('/api/events')
    assert(status === 200, `expected 200, saw ${status}`)
    assert(json.events.length === 12, `expected 12, saw ${json.events.length}`)
    assert(
      json.events.every((event) => event.status === 'published'),
      'a non-published event was served to the public',
    )
    const dates = json.events.map((event) => event.event_date)
    assert([...dates].sort().reverse().join() === dates.join(), 'the list is not newest-first')
    assert(typeof json.events[0].featured === 'boolean', 'featured did not come back as a boolean')
    assert(Array.isArray(json.events[0].gallery), 'gallery did not come back as a list')
    return `${dates[0]} → ${dates[dates.length - 1]}`
  })

  await check('a write-up arrives whole', async () => {
    const { json } = await api('/api/events')
    const longest = json.events.reduce((a, b) => (a.body.length > b.body.length ? a : b))
    assert(longest.body.length === 13639, `the longest write-up is ${longest.body.length} characters`)
    assert(longest.body.includes('##'), 'the write-up looks empty')
    return `${longest.slug}, ${longest.body.length} characters`
  })

  await check('the site copy is untouched, and readable', async () => {
    const { status, json } = await api('/api/settings')
    assert(status === 200, `expected 200, saw ${status}`)
    assert(json.settings === null, 'settings should start empty and fall back to the code defaults')
    return 'null, as expected on a fresh database'
  })

  /* ---- what the key protects --------------------------------------------- */

  await check('the panel cannot read the library without a key', async () => {
    const { status, json } = await api('/api/admin/events')
    assert(status === 403, `expected 403, saw ${status}`)
    assert(json.error.code === 'KEY_REJECTED', `expected KEY_REJECTED, saw ${json.error.code}`)
    return 'refused'
  })

  await check('the panel cannot read the library with the wrong key', async () => {
    const { status } = await api('/api/admin/events', { key: otherKey })
    assert(status === 403, `expected 403, saw ${status}`)
    return 'refused'
  })

  await check('nothing can be written without a key', async () => {
    const { status } = await api('/api/admin/events', {
      method: 'PUT',
      body: { slug: 'sneaking-in', title: 'x', event_date: '2026-01-01' },
    })
    assert(status === 403, `expected 403, saw ${status}`)
    const { json } = await api('/api/events')
    assert(!json.events.some((event) => event.slug === 'sneaking-in'), 'the write went through anyway')
    return 'refused, and nothing appeared'
  })

  await check('a key is confirmed or refused, never guessed at', async () => {
    const good = await api('/api/admin/verify', { method: 'POST', body: { key } })
    const bad = await api('/api/admin/verify', { method: 'POST', body: { key: 'not-the-key-at-all' } })
    assert(good.json.ok === true, 'the real key was not confirmed')
    assert(bad.json.ok === false, 'a wrong key was confirmed')
    return 'yes for the real one, no for the other'
  })

  /* ---- writing ----------------------------------------------------------- */

  const draft = {
    slug: 'check-suite-draft',
    title: 'A draft that should stay out of sight',
    summary: 'Written by the check suite.',
    body: '# Draft\n\nThis exists only while the checks run.',
    category: 'Workshop',
    event_date: '2026-05-05',
    location: 'DKU',
    role: 'host',
    status: 'draft',
    featured: false,
    gallery: [],
    tags: ['check'],
    cover_image: null,
    source_url: null,
    source_credit: null,
  }

  await check('a draft can be written, and stays out of the public list', async () => {
    const { status, json } = await api('/api/admin/events', { method: 'PUT', body: draft, key })
    assert(status === 200, `expected 200, saw ${status}`)
    assert(json.event.id > 0, 'the saved row has no id')
    assert(json.event.tags[0] === 'check', 'the tags did not survive the round trip')
    assert(json.event.featured === false, 'featured came back wrong')

    const publicList = await api('/api/events')
    assert(
      !publicList.json.events.some((event) => event.slug === draft.slug),
      'a draft was served to the public',
    )
    const admins = await api('/api/admin/events', { key })
    assert(admins.json.events.length === 13, `the panel should see 13, saw ${admins.json.events.length}`)
    return 'in the panel, not in public'
  })

  await check('publishing puts it in the public list, archiving takes it out', async () => {
    await api('/api/admin/events/status', {
      method: 'POST',
      body: { slug: draft.slug, status: 'published' },
      key,
    })
    const published = await api('/api/events')
    assert(
      published.json.events.some((event) => event.slug === draft.slug),
      'a published event is missing from the public list',
    )

    await api('/api/admin/events/status', {
      method: 'POST',
      body: { slug: draft.slug, status: 'archived' },
      key,
    })
    const archived = await api('/api/events')
    assert(
      !archived.json.events.some((event) => event.slug === draft.slug),
      'an archived event is still public',
    )
    const admins = await api('/api/admin/events', { key })
    const row = admins.json.events.find((event) => event.slug === draft.slug)
    assert(row?.status === 'archived', 'the record should survive archiving')
    return 'published, then hidden without being lost'
  })

  await check('saving the same slug again overwrites rather than duplicates', async () => {
    await api('/api/admin/events', {
      method: 'PUT',
      body: { ...draft, title: 'Renamed', status: 'published' },
      key,
    })
    const admins = await api('/api/admin/events', { key })
    const matches = admins.json.events.filter((event) => event.slug === draft.slug)
    assert(matches.length === 1, `expected one row, saw ${matches.length}`)
    assert(matches[0].title === 'Renamed', 'the title did not change')
    return 'one row, new title'
  })

  await check('an event can be deleted', async () => {
    const removed = await api(`/api/admin/events?slug=${draft.slug}`, { method: 'DELETE', key })
    assert(removed.json.ok === true, 'the delete reported nothing removed')
    const admins = await api('/api/admin/events', { key })
    assert(admins.json.events.length === 12, `expected 12 left, saw ${admins.json.events.length}`)
    return 'gone'
  })

  await check('deleting something that is not there says so', async () => {
    const again = await api(`/api/admin/events?slug=${draft.slug}`, { method: 'DELETE', key })
    assert(again.json.ok === false, 'a second delete claimed success')
    return 'reported honestly'
  })

  await check('a pasted-in photograph is refused, with a reason', async () => {
    const { status, json } = await api('/api/admin/events', {
      method: 'PUT',
      body: { ...draft, cover_image: 'data:image/jpeg;base64,AAAA' },
      key,
    })
    assert(status === 400, `expected 400, saw ${status}`)
    assert(/uploaded/.test(json.error.message), `unexpected message: ${json.error.message}`)
    return 'refused'
  })

  await check('an event without a title or date is refused', async () => {
    const noTitle = await api('/api/admin/events', {
      method: 'PUT',
      body: { slug: 'x', event_date: '2026-01-01' },
      key,
    })
    const noDate = await api('/api/admin/events', {
      method: 'PUT',
      body: { slug: 'x', title: 'x' },
      key,
    })
    assert(noTitle.status === 400 && noDate.status === 400, 'an incomplete event was accepted')
    return 'refused'
  })

  await check('the site copy can be saved and read back', async () => {
    const settings = { club_name: 'DKU AI Club', hero_title: 'Set by the checks' }
    const saved = await api('/api/admin/settings', { method: 'PUT', body: { settings }, key })
    assert(saved.json.ok === true, 'the save reported failure')
    const read = await api('/api/settings')
    assert(read.json.settings.hero_title === 'Set by the checks', 'the copy did not come back')
    return 'round-tripped'
  })

  /* ---- photographs ------------------------------------------------------- */

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9])

  let storedUrl = null

  await check('a photograph can be uploaded and is served back', async () => {
    const upload = await api('/api/admin/images?name=' + draft.slug, {
      method: 'POST',
      raw: jpeg,
      contentType: 'image/jpeg',
      key,
    })
    assert(upload.status === 200, `expected 200, saw ${upload.status}: ${upload.text}`)
    assert(upload.json.url.startsWith('/media/'), `unexpected url: ${upload.json.url}`)
    storedUrl = upload.json.url

    const served = await fetch(BASE + storedUrl)
    assert(served.status === 200, `expected 200 from ${storedUrl}, saw ${served.status}`)
    assert(
      served.headers.get('content-type')?.startsWith('image/jpeg'),
      `unexpected content type: ${served.headers.get('content-type')}`,
    )
    assert(
      /immutable/.test(served.headers.get('cache-control') ?? ''),
      'an image that never changes should cache for a long time',
    )
    return storedUrl
  })

  await check('an uploaded photograph can be attached to an event', async () => {
    const saved = await api('/api/admin/events', {
      method: 'PUT',
      body: { ...draft, cover_image: storedUrl, gallery: [storedUrl], status: 'published' },
      key,
    })
    assert(saved.status === 200, `expected 200, saw ${saved.status}: ${saved.text}`)
    assert(saved.json.event.cover_image === storedUrl, 'the cover did not stick')
    assert(saved.json.event.gallery.length === 1, 'the gallery did not stick')
    await api(`/api/admin/events?slug=${draft.slug}`, { method: 'DELETE', key })
    return 'attached, then cleaned up'
  })

  await check('a file that is not an image is refused', async () => {
    const { status } = await api('/api/admin/images', {
      method: 'POST',
      raw: new TextEncoder().encode('<html></html>'),
      contentType: 'text/html',
      key,
    })
    assert(status === 415, `expected 415, saw ${status}`)
    return 'refused'
  })

  await check('uploading needs the key', async () => {
    const { status } = await api('/api/admin/images', {
      method: 'POST',
      raw: jpeg,
      contentType: 'image/jpeg',
    })
    assert(status === 403, `expected 403, saw ${status}`)
    return 'refused'
  })

  /* ---- the key itself ---------------------------------------------------- */

  await check('the key can be replaced, and the old one stops working', async () => {
    const next = 'a-replacement-key-for-the-checks-0001'
    const replaced = await api('/api/admin/key', {
      method: 'POST',
      body: { current: key, next },
      key,
    })
    assert(replaced.status === 200, `expected 200, saw ${replaced.status}: ${replaced.text}`)

    const withOld = await api('/api/admin/events', { key })
    assert(withOld.status === 403, `the old key still works (${withOld.status})`)
    const withNew = await api('/api/admin/events', { key: next })
    assert(withNew.status === 200, `the new key does not work (${withNew.status})`)

    const restored = await api('/api/admin/key', {
      method: 'POST',
      body: { current: next, next: key },
      key: next,
    })
    assert(restored.status === 200, 'could not put the original key back')
    const backAgain = await api('/api/admin/events', { key })
    assert(backAgain.status === 200, 'the original key was not restored')
    return 'old refused, new accepted, original restored'
  })

  await check('replacing the key needs the current one', async () => {
    const { status, json } = await api('/api/admin/key', {
      method: 'POST',
      body: { current: otherKey, next: 'another-replacement-key-long-enough' },
      key,
    })
    assert(status === 403, `expected 403, saw ${status}`)
    assert(json.error.code === 'KEY_REJECTED', `expected KEY_REJECTED, saw ${json.error.code}`)
    return 'refused'
  })

  await check('a short replacement key is refused', async () => {
    const { status } = await api('/api/admin/key', {
      method: 'POST',
      body: { current: key, next: 'too-short' },
      key,
    })
    assert(status === 400, `expected 400, saw ${status}`)
    return 'refused'
  })

  /* ---- the site itself --------------------------------------------------- */

  await check('the built site is served from the same origin', async () => {
    const page = await fetch(BASE + '/')
    const html = await page.text()
    assert(page.status === 200, `expected 200, saw ${page.status}`)
    assert(/<div id="root">/.test(html), 'the entry page does not look like the built site')
    return `${html.length} bytes of HTML`
  })

  await check('an unknown API path answers 404 rather than the site', async () => {
    const { status, json } = await api('/api/admin/nonsense', { key })
    assert(status === 404, `expected 404, saw ${status}`)
    assert(json.error.code === 'NOT_FOUND', `expected NOT_FOUND, saw ${json.error.code}`)
    return '404'
  })

  await check('a photograph that is not there answers 404', async () => {
    const response = await fetch(`${BASE}/media/events/2026-09/nothing-here.jpg`)
    assert(response.status === 404, `expected 404, saw ${response.status}`)
    return '404'
  })
} finally {
  await stopServer()
}

console.log('')
if (failures.length) {
  console.log(`  ${passed} passed, ${failures.length} failed`)
  for (const failure of failures) console.log(`    ${failure}`)
  process.exit(1)
}
console.log(`  ${passed} checks passed`)
